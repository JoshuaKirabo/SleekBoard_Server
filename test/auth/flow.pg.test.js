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
import { AuthController } from "../../src/controllers/auth.controller.js";
import { authRoutes } from "../../src/routes/auth.router.js";
import { sessions, SESSION_COOKIE } from "../../src/config/session.js";
import { CurrentUser } from "../../src/services/users/CurrentUser.js";
import { requireUser } from "../../src/middleware/requireUser.js";
import { JobStore } from "../../src/services/jobs/JobStore.js";

// Sign-in end to end: the real routes, passport, sessions in the test database's sessions table, and a stand-in
// Google on another port answering the authorize, token and userinfo calls. Behind them, the lock and a real JobStore,
// to show a signed-in person only ever sees their own jobs. Skipped unless TEST_DATABASE_URL is set.
const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : "TEST_DATABASE_URL isn't set";
const CLIENT = "http://localhost:5999";

let db;
let pool;
let app;
let fakeGoogle;
const servers = [];
const ownerEmail = `owner-${randomUUID()}@example.com`;
// A second person let in for these tests only, to check two signed-in people stay apart.
const friendEmail = `friend-${randomUUID()}@example.com`;
// Who each made-up authorization code signs in as.
const codes = new Map();
// Every session id the tests were handed, so after() can sweep them all, signed in or not.
const sids = new Set();

const listen = (handler) => new Promise((resolve) =>
  {
    const server = handler.listen(0, "127.0.0.1", () => resolve(server));
    servers.push(server);
  });

const base = (server) => `http://127.0.0.1:${server.address().port}`;

// Google's three endpoints. The code turns into a token naming the person, and the token into their userinfo.
const googleStandIn = () =>
  {
    const google = express();
    google.use(express.urlencoded({ extended: false }));
    google.post("/token", (req, res) =>
      {
        if(!codes.has(req.body.code)) return res.status(400).json({ error: "invalid_grant" });
        res.json({ access_token: `token-${req.body.code}`, token_type: "Bearer", expires_in: 3600 });
      });
    google.get("/userinfo", (req, res) =>
      {
        // passport's oauth library sends it as ?access_token=; Google takes that or a Bearer header.
        const token = String(req.query.access_token || req.headers.authorization || "").replace(/^Bearer /, "");
        const person = codes.get(token.replace(/^token-/, ""));
        if(!person) return res.status(401).json({ error: "invalid_token" });
        res.json(person);
      });
    return google;
  };

// A code Google would hand back for this person.
const codeFor = (person) =>
  {
    const code = randomUUID();
    codes.set(code, { sub: randomUUID(), name: "Test", email_verified: true, ...person });
    return code;
  };

// The session cookie a response set, as a Cookie header.
const cookieFrom = (res) =>
  {
    const set = res.headers.getSetCookie().find((line) => line.startsWith(`${SESSION_COOKIE}=`));
    if(!set) return "";
    const cookie = set.split(";")[0];
    if(sidOf(cookie)) sids.add(sidOf(cookie));
    return cookie;
  };

// The session's id inside a signed cookie (s:<id>.<signature>).
const sidOf = (cookie) => decodeURIComponent(cookie.split("=")[1] || "").replace(/^s:/, "").split(".")[0];

const get = (path, cookie = "") => fetch(`${base(app)}${path}`, { redirect: "manual", headers: cookie ? { cookie } : {} });

// Start a sign-in: the redirect to Google, its state, and the cookie that holds it.
const start = async () =>
  {
    const res = await get("/api/auth/google");
    const google = new URL(res.headers.get("location"));
    return { res, google, state: google.searchParams.get("state"), cookie: cookieFrom(res) };
  };

// The whole trip: start, then come back from Google with this person's code.
const signInAs = async (person) =>
  {
    const begun = await start();
    const back = await get(`/api/auth/google/callback?code=${codeFor(person)}&state=${begun.state}`, begun.cookie);
    return { begun, back, cookie: cookieFrom(back) };
  };

// The owner's Google id, once their first sign-in has linked it.
const ownerSub = async () => (await db.federatedCredential.findFirst({ where: { user: { email: ownerEmail } } })).subject;

const me = async (cookie) =>
  {
    const res = await get("/api/auth/me", cookie);
    return { status: res.status, body: await res.json() };
  };

const sessionRows = async (cookie) =>
  {
    const { rows } = await pool.query("select count(*)::int as n from sessions where sid = $1", [sidOf(cookie)]);
    return rows[0].n;
  };

const allSessions = async () => (await pool.query("select count(*)::int as n from sessions")).rows[0].n;

before(async () =>
  {
    if(skip) return;
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    pool = new pg.Pool({ connectionString: url, max: 2 });
    fakeGoogle = await listen(googleStandIn());

    const env = { SESSION_SECRET: randomBytes(32).toString("base64url"), GMAIL_CLIENT_ID: "test-client", GMAIL_CLIENT_SECRET: "test-secret", CLIENT_URL: CLIENT };
    const settings = new AuthSettings({ env });
    const passport = new Passport();
    const logins = new LoginBook({ db, linkableEmail: ownerEmail });
    const signIn = new SignIn({ gate: new SignInGate({ emails: [ownerEmail, friendEmail] }), logins });
    const people = new CurrentUser();
    const jobs = new JobStore({ db, userId: () => people.id() });

    const server = express();
    server.use("/api", sessions({ settings, pool, prune: false }), passport.authenticate("session"));
    server.use("/api/auth", authRoutes(new AuthController({ passport, settings })));
    // The same lock routes/index.js puts in front of jobs, contacts, runs and Gmail.
    server.use("/api", requireUser(people));
    server.get("/api/jobs", async (req, res) => res.json(await jobs.list()));
    server.get("/api/jobs/:id", async (req, res) =>
      {
        const job = await jobs.find(req.params.id);
        if(!job) return res.status(404).json({ message: "No such job." });
        res.json(job);
      });
    app = await listen(server);

    // The callback needs the app's port, so passport is set up once it's listening.
    env.GOOGLE_SIGNIN_REDIRECT_URI = `${base(app)}/api/auth/google/callback`;
    const google = { authorizationURL: `${base(fakeGoogle)}/authorize`, tokenURL: `${base(fakeGoogle)}/token`, userProfileURL: `${base(fakeGoogle)}/userinfo` };
    new PassportSetup({ passport, settings, signIn, logins, google }).install();

    // The owner as db:copy left them: an account with data and no login yet.
    const owner = await db.user.create({ data: { email: ownerEmail, name: "Owner" } });
    await db.job.create({ data: { userId: owner.id, company: "Stripe", role: "SWE" } });
  });

after(async () =>
  {
    if(skip) return;
    const users = await db.user.findMany({ where: { OR: [{ email: ownerEmail }, { email: friendEmail }, { email: { startsWith: "stranger-" } }] }, select: { id: true } });
    const ids = users.map((user) => user.id);
    await pool.query("delete from sessions where sid = any($1) or sess->'passport'->>'user' = any($2)", [[...sids], ids]);
    await db.user.deleteMany({ where: { id: { in: ids } } });
    for(const server of servers) server.close();
    await pool.end();
    await db.$disconnect();
  });

test("starting sends you to Google with profile + email, our callback, and a one-time state", { skip }, async () =>
  {
    const { res, google, state, cookie } = await start();
    assert.equal(res.status, 302);
    assert.equal(`${google.origin}${google.pathname}`, `${base(fakeGoogle)}/authorize`);
    assert.equal(google.searchParams.get("scope"), "profile email");
    assert.equal(google.searchParams.get("redirect_uri"), `${base(app)}/api/auth/google/callback`);
    assert.equal(google.searchParams.get("client_id"), "test-client");
    assert.ok(state && state.length >= 20);
    assert.ok(cookie, "the state's session needs a cookie");
    assert.equal(await sessionRows(cookie), 1);
  });

test("the owner signs in, lands on the board, and is the account db:copy made", { skip }, async () =>
  {
    const { begun, back, cookie } = await signInAs({ email: ownerEmail });
    assert.equal(back.status, 302);
    assert.equal(back.headers.get("location"), `${CLIENT}/`);
    const set = back.headers.getSetCookie().find((line) => line.startsWith(`${SESSION_COOKIE}=`));
    assert.match(set, /HttpOnly/);
    assert.match(set, /SameSite=Lax/);
    const who = await me(cookie);
    assert.equal(who.status, 200);
    assert.equal(who.body.user.email, ownerEmail);
    const owner = await db.user.findUnique({ where: { email: ownerEmail } });
    assert.equal(who.body.user.id, owner.id);
    assert.equal(await db.job.count({ where: { userId: owner.id } }), 1);
    // A fresh session after signing in: the cookie from before Google isn't signed in, and its row is gone.
    assert.notEqual(cookie, begun.cookie);
    assert.equal((await me(begun.cookie)).status, 401);
    assert.equal(await sessionRows(begun.cookie), 0);
  });

test("signing in again keeps the same account and doesn't add a second login", { skip }, async () =>
  {
    const owner = await db.user.findUnique({ where: { email: ownerEmail } });
    const { cookie } = await signInAs({ email: ownerEmail, sub: await ownerSub() });
    assert.equal((await me(cookie)).body.user.id, owner.id);
    assert.equal(await db.federatedCredential.count({ where: { userId: owner.id } }), 1);
  });

test("someone else's Google account is turned away and no account is made for them", { skip }, async () =>
  {
    const stranger = `stranger-${randomUUID()}@example.com`;
    const { back, cookie } = await signInAs({ email: stranger });
    assert.equal(back.headers.get("location"), `${CLIENT}/login?signin=error&reason=not_allowed`);
    assert.equal(await db.user.count({ where: { email: stranger } }), 0);
    assert.equal((await me(cookie)).status, 401);
  });

test("the owner's email unverified by Google is turned away", { skip }, async () =>
  {
    const { back } = await signInAs({ email: ownerEmail, email_verified: false });
    assert.equal(back.headers.get("location"), `${CLIENT}/login?signin=error&reason=not_allowed`);
  });

test("a second Google account using the owner's email can't take over the owner's account", { skip }, async () =>
  {
    const { back, cookie } = await signInAs({ email: ownerEmail, sub: randomUUID() });
    assert.equal(back.headers.get("location"), `${CLIENT}/login?signin=error&reason=not_linkable`);
    assert.equal((await me(cookie)).status, 401);
  });

test("a callback whose state this browser didn't start is refused", { skip }, async () =>
  {
    const mine = await start();
    const theirs = await start();
    const forged = await get(`/api/auth/google/callback?code=${codeFor({ email: ownerEmail })}&state=${theirs.state}`, mine.cookie);
    assert.equal(forged.headers.get("location"), `${CLIENT}/login?signin=error&reason=expired`);
    const noCookie = await get(`/api/auth/google/callback?code=${codeFor({ email: ownerEmail })}&state=${theirs.state}`);
    assert.equal(noCookie.headers.get("location"), `${CLIENT}/login?signin=error&reason=expired`);
    assert.equal((await me(mine.cookie)).status, 401);
  });

test("a state only works once", { skip }, async () =>
  {
    const begun = await start();
    const first = await get(`/api/auth/google/callback?code=${codeFor({ email: ownerEmail, sub: await ownerSub() })}&state=${begun.state}`, begun.cookie);
    assert.equal(first.headers.get("location"), `${CLIENT}/`);
    const replay = await get(`/api/auth/google/callback?code=${codeFor({ email: ownerEmail })}&state=${begun.state}`, begun.cookie);
    assert.equal(replay.headers.get("location"), `${CLIENT}/login?signin=error&reason=expired`);
  });

test("pressing Cancel on Google comes back as cancelled", { skip }, async () =>
  {
    const begun = await start();
    const back = await get(`/api/auth/google/callback?error=access_denied&state=${begun.state}`, begun.cookie);
    assert.equal(back.headers.get("location"), `${CLIENT}/login?signin=error&reason=cancelled`);
  });

test("a code Google won't swap for a token ends at the login screen, not a crash", { skip }, async () =>
  {
    const begun = await start();
    const back = await get(`/api/auth/google/callback?code=made-up&state=${begun.state}`, begun.cookie);
    assert.equal(back.headers.get("location"), `${CLIENT}/login?signin=error&reason=google`);
  });

test("signing out ends the session: its row goes, the cookie is cleared, and it no longer works", { skip }, async () =>
  {
    const { cookie } = await signInAs({ email: ownerEmail, sub: await ownerSub() });
    assert.equal((await me(cookie)).status, 200);
    const before = await allSessions();
    const out = await fetch(`${base(app)}/api/auth/logout`, { method: "POST", headers: { cookie } });
    assert.equal(out.status, 204);
    // Only the clearing cookie comes back, not a fresh session to replace it.
    assert.deepEqual(out.headers.getSetCookie().filter((line) => line.startsWith(`${SESSION_COOKIE}=`)).map((line) => line.split(";")[0]), [`${SESSION_COOKIE}=`]);
    assert.equal(await allSessions(), before - 1, "signing out left a session behind");
    assert.equal(await sessionRows(cookie), 0);
    assert.equal((await me(cookie)).status, 401);
  });

test("a made-up or tampered cookie isn't signed in", { skip }, async () =>
  {
    assert.equal((await me(`${SESSION_COOKIE}=s%3Anot-a-session.bad-signature`)).status, 401);
    assert.equal((await me()).status, 401);
  });

test("nothing behind the lock answers without a session, or with a forged one", { skip }, async () =>
  {
    assert.equal((await get("/api/jobs")).status, 401);
    assert.equal((await get("/api/jobs", `${SESSION_COOKIE}=s%3Anot-a-session.bad-signature`)).status, 401);
  });

test("two signed-in people each see only their own jobs, and can't open the other's by id", { skip }, async () =>
  {
    const owner = (await signInAs({ email: ownerEmail, sub: await ownerSub() })).cookie;
    const friend = (await signInAs({ email: friendEmail })).cookie;
    const ownerJobs = await (await get("/api/jobs", owner)).json();
    assert.deepEqual(ownerJobs.map((job) => job.company), ["Stripe"]);
    assert.deepEqual(await (await get("/api/jobs", friend)).json(), []);
    assert.equal((await get(`/api/jobs/${ownerJobs[0].id}`, friend)).status, 404);
    assert.equal((await get(`/api/jobs/${ownerJobs[0].id}`, owner)).status, 200);
  });

test("signing out locks the door again", { skip }, async () =>
  {
    const { cookie } = await signInAs({ email: ownerEmail, sub: await ownerSub() });
    assert.equal((await get("/api/jobs", cookie)).status, 200);
    await fetch(`${base(app)}/api/auth/logout`, { method: "POST", headers: { cookie } });
    assert.equal((await get("/api/jobs", cookie)).status, 401);
  });
