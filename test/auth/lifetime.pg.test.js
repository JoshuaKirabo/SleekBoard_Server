import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import express from "express";
import pg from "pg";
import { Passport } from "passport";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.ts";
import { AuthSettings } from "../../src/services/auth/AuthSettings.js";
import { SignInGate } from "../../src/services/auth/SignInGate.js";
import { LoginBook } from "../../src/services/auth/LoginBook.js";
import { SignIn } from "../../src/services/auth/SignIn.js";
import { PassportSetup } from "../../src/services/auth/PassportSetup.js";
import { PasswordBook } from "../../src/services/auth/PasswordBook.js";
import { PasswordHash } from "../../src/services/auth/PasswordHash.js";
import { PasswordSignIn } from "../../src/services/auth/PasswordSignIn.js";
import { DecoyHash } from "../../src/services/auth/DecoyHash.js";
import { SessionLifetime } from "../../src/services/auth/SessionLifetime.js";
import { AuthController } from "../../src/controllers/auth.controller.js";
import { authRoutes } from "../../src/routes/auth.router.js";
import { sessions, SESSION_COOKIE } from "../../src/config/session.js";
import { CappedPgStore } from "../../src/config/CappedPgStore.js";
import { CurrentUser } from "../../src/services/users/CurrentUser.js";
import { requireUser } from "../../src/middleware/requireUser.js";

// The absolute timeout end to end: email + password sign-ins through the real route, sessions in the test database,
// the CappedPgStore that sessions() builds on SessionLifetime, and requireUser's lock behind them. Time passing is
// stood in for by moving a row's stamp (sess.signedInAt) or its end inside Postgres; every time is compared there too,
// since expire has no time zone and Postgres and Node can sit in different ones. Skipped unless TEST_DATABASE_URL is
// set.
const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : "TEST_DATABASE_URL isn't set";
const PASSWORD = "correct horse battery";
const DAY_MS = 24 * 60 * 60_000;
const MAX_MS = 30 * DAY_MS;

let db;
let pool;
let app;
let lifetime;
const ownerEmail = `owner-${randomUUID()}@example.com`;
// Every session id the tests were handed, so after() can sweep them all.
const sids = new Set();

// Limits that never block; they have tests of their own (limits.test.js, limits.pg.test.js).
class NoLimits
  {
    async countTry()
      {
        return 0;
      }

    async succeeded()
      {
      }
  }

const base = () => `http://127.0.0.1:${app.address().port}`;

// The session's id inside a signed cookie (s:<id>.<signature>).
const sidOf = (cookie) => decodeURIComponent(cookie.split("=")[1] || "").replace(/^s:/, "").split(".")[0];

// The whole Set-Cookie line for the session, or "".
const setCookieOf = (res) => res.headers.getSetCookie().find((line) => line.startsWith(`${SESSION_COOKIE}=`)) || "";

// The session cookie a response set, as a Cookie header.
const cookieFrom = (res) =>
  {
    const cookie = setCookieOf(res).split(";")[0];
    if(sidOf(cookie)) sids.add(sidOf(cookie));
    return cookie;
  };

const logIn = (remember, cookie = "") => fetch(`${base()}/api/auth/login`,
  {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie && { cookie }) },
    body: JSON.stringify({ email: ownerEmail, password: PASSWORD, remember }),
  });

const signedInCookie = async (remember) => cookieFrom(await logIn(remember));

const me = async (cookie) =>
  {
    const res = await fetch(`${base()}/api/auth/me`, { headers: { cookie } });
    return { status: res.status, text: await res.text(), setCookie: setCookieOf(res) };
  };

// A route behind requireUser, like jobs and contacts.
const locked = async (cookie) => (await fetch(`${base()}/api/locked`, { headers: { cookie } })).status;

// The row: ms until it ends, ms until its sign-in's end, whether it ends at or before that, and the stamp's distance
// from now. All null when there's no row.
const row = async (cookie) =>
  {
    const { rows } = await pool.query(
      `select extract(epoch from expire - localtimestamp) * 1000 as left_ms,
              (sess->>'signedInAt')::bigint + $2 - extract(epoch from now()) * 1000 as stamp_left_ms,
              expire <= to_timestamp(((sess->>'signedInAt')::bigint + $2) / 1000.0)::timestamp as within,
              abs((sess->>'signedInAt')::bigint - extract(epoch from now()) * 1000) as stamp_off_ms,
              sess
         from sessions where sid = $1`, [sidOf(cookie), MAX_MS]);
    return rows[0] || null;
  };

// Stands in for time passing: moves the stamp so the sign-in's end is `left` from now (a Postgres interval).
const stampEndsIn = (cookie, left) => pool.query(
  "update sessions set sess = jsonb_set(sess::jsonb, '{signedInAt}', to_jsonb((extract(epoch from now() + $2::interval) * 1000)::bigint - $3))::json where sid = $1",
  [sidOf(cookie), left, MAX_MS]);

// Moves the row's own end to `left` from now.
const rowEndsIn = (cookie, left) => pool.query("update sessions set expire = localtimestamp + $2::interval where sid = $1", [sidOf(cookie), left]);

// A session signed in before stamps existed.
const unstamp = (cookie) => pool.query("update sessions set sess = (sess::jsonb - 'signedInAt')::json where sid = $1", [sidOf(cookie)]);

const allSessions = async () => (await pool.query("select count(*)::int as n from sessions")).rows[0].n;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

before(async () =>
  {
    if(skip) return;
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    pool = new pg.Pool({ connectionString: url, max: 2 });

    const settings = new AuthSettings({ env: { SESSION_SECRET: randomBytes(32).toString("base64url") } });
    lifetime = new SessionLifetime({ settings });
    const passport = new Passport();
    const gate = new SignInGate({ emails: [ownerEmail] });
    const logins = new LoginBook({ db, linkableEmail: ownerEmail });
    const hasher = new PasswordHash();
    const decoy = new DecoyHash({ hasher });
    await decoy.stored();
    const passwords = new PasswordSignIn({ gate, passwords: new PasswordBook({ db }), hasher, decoy });
    new PassportSetup({ passport, settings, signIn: new SignIn({ gate, logins }), logins, passwords }).install();

    const server = express();
    server.use(express.json());
    server.use("/api", sessions({ settings, pool, prune: false, lifetime }), passport.authenticate("session"));
    server.use("/api/auth", authRoutes(new AuthController({ passport, settings, limits: new NoLimits(), lifetime })));
    server.use("/api", requireUser(new CurrentUser()));
    server.get("/api/locked", (req, res) => res.json({ ok: true }));
    app = await new Promise((resolve) =>
      {
        const listening = server.listen(0, "127.0.0.1", () => resolve(listening));
      });

    await db.user.create({ data: { email: ownerEmail, name: "Owner", passwordHash: await hasher.make(PASSWORD) } });
  });

after(async () =>
  {
    if(skip) return;
    const owner = await db.user.findUnique({ where: { email: ownerEmail }, select: { id: true } });
    await pool.query("delete from sessions where sid = any($1) or sess->'passport'->>'user' = $2", [[...sids], owner.id]);
    await db.user.delete({ where: { id: owner.id } });
    app.close();
    await pool.end();
    await db.$disconnect();
  });

test("signing in stamps the session in its row, and the stamp is never sent to the browser", { skip }, async () =>
  {
    const res = await logIn(true);
    const body = await res.text();
    const cookie = cookieFrom(res);
    const stamped = await row(cookie);
    assert.ok(Number(stamped.stamp_off_ms) < 60_000, `stamped ${stamped.stamp_off_ms} ms from now`);
    assert.equal(stamped.within, true);
    const who = await me(cookie);
    assert.equal(who.status, 200);
    for(const text of [body, who.text, setCookieOf(res), who.setCookie]) assert.doesNotMatch(text, /signedInAt/);
  });

test("ticked, 30 days after sign-in: /me and the lock answer 401 and the row is deleted, though the browser's cookie hasn't ended", { skip }, async () =>
  {
    const res = await logIn(true);
    const cookie = cookieFrom(res);
    assert.ok(new Date(/Expires=([^;]+)/.exec(setCookieOf(res))[1]) > Date.now(), "the browser would still send it");
    await stampEndsIn(cookie, "-1 second");
    const rowsBefore = await allSessions();
    const who = await me(cookie);
    assert.equal(who.status, 401);
    assert.equal(who.setCookie, "", "a signed-out request doesn't need a new cookie");
    assert.equal(await row(cookie), null);
    assert.equal(await allSessions(), rowsBefore - 1, "an empty session was saved in its place");
    assert.equal(await locked(cookie), 401);
  });

test("ticked, used a minute before its end: it still works, and its row now ends with the stamp instead of 30 days on", { skip }, async () =>
  {
    const cookie = await signedInCookie(true);
    await stampEndsIn(cookie, "1 minute");
    const before = await row(cookie);
    assert.ok(Number(before.left_ms) > 29 * DAY_MS, "the row still had its 30 days before this request");
    assert.equal((await me(cookie)).status, 200);
    assert.equal(await locked(cookie), 200);
    const after = await row(cookie);
    assert.equal(after.within, true, "the row ends after the stamp's 30 days");
    assert.ok(Number(after.left_ms) <= 60_000 && Number(after.left_ms) > 50_000, `row ends in ${after.left_ms} ms`);
    assert.equal(after.sess.signedInAt, before.sess.signedInAt, "using it moved the stamp");
  });

test("a row cut back to its stamp is swept on time, with no request to turn away", { skip }, async () =>
  {
    const cookie = await signedInCookie(true);
    await stampEndsIn(cookie, "2 seconds");
    assert.equal((await me(cookie)).status, 200);
    assert.equal((await row(cookie)).within, true);
    await wait(3_200);
    const sweeper = new CappedPgStore({ lifetime, pool, tableName: "sessions", pruneSessionInterval: false });
    await new Promise((resolve, reject) => sweeper.pruneSessions((error) => (error ? reject(error) : resolve())));
    assert.equal(await row(cookie), null);
  });

test("ticked, every request for 30 days still can't push it past the stamp", { skip }, async () =>
  {
    const cookie = await signedInCookie(true);
    // Each step stands in for a request a day or so later; the row's own end is put back to 30 days each time, as
    // connect-pg-simple's touch would have done before.
    for(const left of ["20 days", "5 days", "1 hour"])
      {
        await stampEndsIn(cookie, left);
        await rowEndsIn(cookie, "30 days");
        assert.equal((await me(cookie)).status, 200, left);
        assert.equal((await row(cookie)).within, true, left);
      }
    await stampEndsIn(cookie, "-1 second");
    assert.equal((await me(cookie)).status, 401);
    assert.equal(await row(cookie), null);
  });

test("unticked: a day with no request still ends it", { skip }, async () =>
  {
    const cookie = await signedInCookie(false);
    const fresh = await row(cookie);
    assert.ok(Math.abs(Number(fresh.left_ms) - DAY_MS) < 60_000, `row ends in ${fresh.left_ms} ms`);
    assert.equal(fresh.sess.cookie.expires, null);
    await rowEndsIn(cookie, "-1 second");
    assert.equal((await me(cookie)).status, 401);
  });

test("unticked: in its last hour, a request doesn't give it another day, and past the stamp it's signed out", { skip }, async () =>
  {
    const cookie = await signedInCookie(false);
    await stampEndsIn(cookie, "1 hour");
    const who = await me(cookie);
    assert.equal(who.status, 200);
    assert.doesNotMatch(who.setCookie, /Expires=|Max-Age=/, "the browser's cookie stays dateless");
    const after = await row(cookie);
    assert.equal(after.within, true);
    assert.ok(Number(after.left_ms) <= 60 * 60_000 && Number(after.left_ms) > 59 * 60_000, `row ends in ${after.left_ms} ms`);
    await stampEndsIn(cookie, "-1 second");
    assert.equal((await me(cookie)).status, 401);
    assert.equal(await row(cookie), null);
  });

test("a signed-in session with no stamp, from before this check, is signed out once, and signing in again works", { skip }, async () =>
  {
    const cookie = await signedInCookie(true);
    await unstamp(cookie);
    assert.equal((await me(cookie)).status, 401);
    assert.equal(await row(cookie), null);
    // The same browser, still sending the dead cookie, signs straight back in.
    const again = await logIn(true, cookie);
    assert.equal(again.status, 200);
    const fresh = cookieFrom(again);
    assert.notEqual(fresh, cookie);
    assert.equal((await me(fresh)).status, 200);
    assert.ok(Number((await row(fresh)).stamp_off_ms) < 60_000);
  });

test("a stamp that isn't a number counts as no stamp", { skip }, async () =>
  {
    const cookie = await signedInCookie(true);
    await pool.query("update sessions set sess = jsonb_set(sess::jsonb, '{signedInAt}', '\"2099-01-01\"')::json where sid = $1", [sidOf(cookie)]);
    assert.equal((await me(cookie)).status, 401);
    assert.equal(await row(cookie), null);
  });

test("signing in again gives a fresh 30 days, and the old session's row goes", { skip }, async () =>
  {
    const old = await signedInCookie(true);
    await stampEndsIn(old, "1 hour");
    const fresh = cookieFrom(await logIn(true, old));
    assert.equal(await row(old), null);
    const stamped = await row(fresh);
    assert.ok(Number(stamped.stamp_left_ms) > MAX_MS - 60_000, `the new sign-in ends in ${stamped.stamp_left_ms} ms`);
  });
