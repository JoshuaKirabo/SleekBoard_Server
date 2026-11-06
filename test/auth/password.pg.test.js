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
import { AuthController, WRONG_LOGIN } from "../../src/controllers/auth.controller.js";
import { authRoutes } from "../../src/routes/auth.router.js";
import { sessions, SESSION_COOKIE } from "../../src/config/session.js";

// Email + password sign-in end to end: the real /api/auth/login route, passport, argon2 hashes in the test database's
// users table, and sessions in its sessions table. Skipped unless TEST_DATABASE_URL is set; `npm run test:db` runs it.
const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : "TEST_DATABASE_URL isn't set";
const PASSWORD = "correct horse battery";
const DAY_MS = 24 * 60 * 60_000;

let db;
let pool;
let app;
const ownerEmail = `owner-${randomUUID()}@example.com`;
// Has a password but isn't on the gate's list.
const strangerEmail = `stranger-${randomUUID()}@example.com`;
// On the list, but only ever signed in with Google, so no password.
const googleOnlyEmail = `google-${randomUUID()}@example.com`;
// Every session id the tests were handed, so after() can sweep them all.
const sids = new Set();

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

const logIn = (body, cookie = "") => fetch(`${base()}/api/auth/login`,
  {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie && { cookie }) },
    body: JSON.stringify(body),
  });

const me = async (cookie) =>
  {
    const res = await fetch(`${base()}/api/auth/me`, { headers: cookie ? { cookie } : {} });
    return { status: res.status, body: await res.json(), setCookie: setCookieOf(res) };
  };

// The session's row: how many ms until Postgres drops it, and the cookie it keeps. The time left is worked out inside
// Postgres, since expire has no time zone and Postgres and Node can sit in different ones.
const sessionRow = async (cookie) =>
  {
    const { rows } = await pool.query("select extract(epoch from expire - localtimestamp) * 1000 as left_ms, sess from sessions where sid = $1", [sidOf(cookie)]);
    return rows[0] || null;
  };

before(async () =>
  {
    if(skip) return;
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    pool = new pg.Pool({ connectionString: url, max: 2 });

    const settings = new AuthSettings({ env: { SESSION_SECRET: randomBytes(32).toString("base64url") } });
    const passport = new Passport();
    const gate = new SignInGate({ emails: [ownerEmail, googleOnlyEmail] });
    const logins = new LoginBook({ db, linkableEmail: ownerEmail });
    new PassportSetup({ passport, settings, signIn: new SignIn({ gate, logins }), logins }).install();
    const hasher = new PasswordHash();
    const passwords = new PasswordSignIn({ gate, passwords: new PasswordBook({ db }), hasher });

    const server = express();
    server.use(express.json());
    server.use(express.urlencoded({ extended: true }));
    server.use("/api", sessions({ settings, pool, prune: false }), passport.authenticate("session"));
    server.use("/api/auth", authRoutes(new AuthController({ passport, settings, passwords })));
    app = await new Promise((resolve) =>
      {
        const listening = server.listen(0, "127.0.0.1", () => resolve(listening));
      });

    const passwordHash = await hasher.make(PASSWORD);
    await db.user.create({ data: { email: ownerEmail, name: "Owner", passwordHash } });
    await db.user.create({ data: { email: strangerEmail, name: "Stranger", passwordHash } });
    await db.user.create({ data: { email: googleOnlyEmail, name: "Google" } });
  });

after(async () =>
  {
    if(skip) return;
    const users = await db.user.findMany({ where: { email: { in: [ownerEmail, strangerEmail, googleOnlyEmail] } }, select: { id: true } });
    const ids = users.map((user) => user.id);
    await pool.query("delete from sessions where sid = any($1) or sess->'passport'->>'user' = any($2)", [[...sids], ids]);
    await db.user.deleteMany({ where: { id: { in: ids } } });
    app.close();
    await pool.end();
    await db.$disconnect();
  });

test("the right password signs the owner in, answering with their public fields and a session cookie", { skip }, async () =>
  {
    const res = await logIn({ email: ownerEmail, password: PASSWORD, remember: true });
    assert.equal(res.status, 200);
    const owner = await db.user.findUnique({ where: { email: ownerEmail } });
    assert.deepEqual(await res.json(), { user: { id: owner.id, email: ownerEmail, name: "Owner" } });
    assert.match(setCookieOf(res), /HttpOnly/);
    assert.match(setCookieOf(res), /SameSite=Lax/);
    const who = await me(cookieFrom(res));
    assert.equal(who.status, 200);
    assert.equal(who.body.user.id, owner.id);
    assert.equal("passwordHash" in who.body.user, false);
  });

test("the email is matched lowercase and trimmed, like the users table keeps it", { skip }, async () =>
  {
    const res = await logIn({ email: `  ${ownerEmail.toUpperCase()} `, password: PASSWORD, remember: true });
    assert.equal(res.status, 200);
    assert.equal((await me(cookieFrom(res))).body.user.email, ownerEmail);
  });

test("remember ticked: the cookie and its row last the usual 30 days", { skip }, async () =>
  {
    const res = await logIn({ email: ownerEmail, password: PASSWORD, remember: true });
    const cookie = cookieFrom(res);
    const expires = new Date(/Expires=([^;]+)/.exec(setCookieOf(res))?.[1]);
    assert.ok(Math.abs(expires - Date.now() - 30 * DAY_MS) < 60_000, `cookie expires ${expires}`);
    const row = await sessionRow(cookie);
    assert.ok(Math.abs(Number(row.left_ms) - 30 * DAY_MS) < 60_000, `row ends in ${row.left_ms} ms`);
  });

test("remember unticked: the cookie has no expiry, so it ends when the browser closes, and stays that way", { skip }, async () =>
  {
    const res = await logIn({ email: ownerEmail, password: PASSWORD, remember: false });
    assert.equal(res.status, 200);
    const cookie = cookieFrom(res);
    assert.doesNotMatch(setCookieOf(res), /Expires=|Max-Age=/);
    const row = await sessionRow(cookie);
    assert.equal(row.sess.cookie.expires, null, "the stored session would hand a dated cookie back later");
    // Using it doesn't quietly turn it back into a 30-day cookie.
    const who = await me(cookie);
    assert.equal(who.status, 200);
    assert.doesNotMatch(who.setCookie, /Expires=|Max-Age=/);
    assert.equal((await sessionRow(cookie)).sess.cookie.expires, null);
  });

test("leaving remember out counts as unticked", { skip }, async () =>
  {
    const res = await logIn({ email: ownerEmail, password: PASSWORD });
    assert.equal(res.status, 200);
    assert.doesNotMatch(setCookieOf(res), /Expires=|Max-Age=/);
  });

test("signing in starts a fresh session: the old cookie's row goes and it no longer works", { skip }, async () =>
  {
    const first = cookieFrom(await logIn({ email: ownerEmail, password: PASSWORD, remember: true }));
    const second = cookieFrom(await logIn({ email: ownerEmail, password: PASSWORD, remember: true }, first));
    assert.notEqual(second, first);
    assert.equal(await sessionRow(first), null);
    assert.equal((await me(first)).status, 401);
    assert.equal((await me(second)).status, 200);
  });

test("a wrong password, an unknown email, a non-owner and a Google-only account all get the same 401 and no session", { skip }, async () =>
  {
    const tries =
      [
        { email: ownerEmail, password: "wrong password" },
        { email: `nobody-${randomUUID()}@example.com`, password: PASSWORD },
        { email: strangerEmail, password: PASSWORD },
        { email: googleOnlyEmail, password: PASSWORD },
        { email: ownerEmail, password: "" },
        { email: ownerEmail },
        {},
      ];
    for(const body of tries)
      {
        const res = await logIn({ ...body, remember: true });
        assert.equal(res.status, 401, JSON.stringify(body));
        assert.deepEqual(await res.json(), { message: WRONG_LOGIN });
        assert.equal(setCookieOf(res), "", `a session was started for ${JSON.stringify(body)}`);
      }
  });

test("a wrong password doesn't sign out a session that's already signed in", { skip }, async () =>
  {
    const cookie = cookieFrom(await logIn({ email: ownerEmail, password: PASSWORD, remember: true }));
    assert.equal((await logIn({ email: ownerEmail, password: "wrong" }, cookie)).status, 401);
    assert.equal((await me(cookie)).status, 200);
  });

test("signing out after a password sign-in ends the session", { skip }, async () =>
  {
    const cookie = cookieFrom(await logIn({ email: ownerEmail, password: PASSWORD, remember: true }));
    const out = await fetch(`${base()}/api/auth/logout`, { method: "POST", headers: { cookie } });
    assert.equal(out.status, 204);
    assert.equal(await sessionRow(cookie), null);
    assert.equal((await me(cookie)).status, 401);
  });
