import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import session from "express-session";
import pg from "pg";
import { Passport } from "passport";
import { LoginLimits, MAX_FAILS_IN_A_ROW, MAX_FAILS_PER_IP_PER_DAY } from "../../src/services/auth/LoginLimits.js";
import { PasswordLogin } from "../../src/services/auth/PasswordLogin.js";
import { PassportSetup } from "../../src/services/auth/PassportSetup.js";
import { AuthController } from "../../src/controllers/auth.controller.js";
import { authRoutes } from "../../src/routes/auth.router.js";

// The failed-try counts in the test database's login_limits table, as the server's database user (sleekboard_app).
// Two LoginLimits on two pools stand for two servers: a count one makes, the other sees. Every key here carries a
// prefix of this run's own, so the real counts and other runs are never touched. Skipped unless TEST_DATABASE_URL is
// set; `npm run test:db` runs it.
const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : "TEST_DATABASE_URL isn't set";
const HOUR = 60 * 60;
const DAY_MS = 24 * 60 * 60_000;

const prefix = `test_${randomUUID().slice(0, 8)}`;
let poolA;
let poolB;
let serverA;
let serverB;

const typed = (email) => new PasswordLogin({ email, password: "x" });

const rowsOf = async (key) =>
  {
    const { rows } = await poolA.query("select key, points, expire from login_limits where key like $1 order by key", [`${prefix}%${key}`]);
    return rows;
  };

before(() =>
  {
    if(skip) return;
    poolA = new pg.Pool({ connectionString: url, max: 5 });
    poolB = new pg.Pool({ connectionString: url, max: 5 });
    serverA = LoginLimits.inPostgres({ pool: poolA, prefix });
    serverB = LoginLimits.inPostgres({ pool: poolB, prefix });
  });

after(async () =>
  {
    if(skip) return;
    await poolA.query("delete from login_limits where key like $1", [`${prefix}%`]);
    await poolA.end();
    await poolB.end();
  });

test("tries counted on two servers add up: 10 between them, and the 11th on either is turned away on both", { skip }, async () =>
  {
    const josh = typed(`josh-${randomUUID()}@example.com`);
    for(let i = 0; i < MAX_FAILS_IN_A_ROW; i++)
      {
        const server = i % 2 === 0 ? serverA : serverB;
        assert.equal(await server.countTry(josh, "10.0.0.1"), 0);
      }
    assert.equal(await serverB.countTry(josh, "10.0.0.1"), HOUR);
    const wait = await serverA.countTry(josh, "10.0.0.1");
    assert.ok(wait > HOUR - 5 && wait <= HOUR, `about an hour, got ${wait}`);
    assert.equal(await serverA.countTry(typed("someone-else@example.com"), "10.0.0.1"), 0);
  });

test("40 tries at once on one email, split over two servers: exactly 10 go ahead", { skip }, async () =>
  {
    const josh = typed(`josh-${randomUUID()}@example.com`);
    const waits = await Promise.all(Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? serverA : serverB).countTry(josh, "10.0.0.6")));
    assert.equal(waits.filter((wait) => wait === 0).length, MAX_FAILS_IN_A_ROW);
    assert.ok(waits.every((wait) => wait === 0 || (wait > HOUR - 5 && wait <= HOUR)));
  });

test("130 tries at once from one IP over many emails, on two servers: exactly 100 go ahead", { skip }, async () =>
  {
    const waits = await Promise.all(Array.from({ length: 130 }, (_, i) => (i % 2 === 0 ? serverA : serverB).countTry(typed(`p${i}-${randomUUID()}@example.com`), "10.0.0.7")));
    assert.equal(waits.filter((wait) => wait === 0).length, MAX_FAILS_PER_IP_PER_DAY);
  });

test("a count outlives the limiter that made it, so a restart doesn't reset it", { skip }, async () =>
  {
    const josh = typed(`josh-${randomUUID()}@example.com`);
    for(let i = 0; i < MAX_FAILS_IN_A_ROW + 1; i++) await serverA.countTry(josh, "10.0.0.2");
    const restarted = LoginLimits.inPostgres({ pool: poolB, prefix });
    assert.ok(await restarted.countTry(josh, "10.0.0.2") > 0);
  });

test("a right password on one server clears the pair for the other, and gives only its own point back to the IP", { skip }, async () =>
  {
    const josh = typed(`josh-${randomUUID()}@example.com`);
    for(let i = 0; i < MAX_FAILS_IN_A_ROW; i++) await serverA.countTry(josh, "10.0.0.3");
    await serverB.succeeded(josh, "10.0.0.3");
    assert.deepEqual(await rowsOf(serverA.keyOf(josh, "10.0.0.3")), []);
    assert.equal((await serverB.byIp.get("10.0.0.3")).consumedPoints, MAX_FAILS_IN_A_ROW - 1);
    for(let i = 0; i < MAX_FAILS_IN_A_ROW; i++) assert.equal(await serverB.countTry(josh, "10.0.0.3"), 0);
  });

test("rows match the library's table: a hashed email in the key, the run kept 90 days, the IP's a day", { skip }, async () =>
  {
    const email = `josh-${randomUUID()}@example.com`;
    await serverA.countTry(typed(email), "10.0.0.4");
    const [pair] = await rowsOf(serverA.keyOf(typed(email), "10.0.0.4"));
    assert.equal(pair.key, `${prefix}_fail_in_a_row_email_ip:${serverA.keyOf(typed(email), "10.0.0.4")}`);
    assert.equal(pair.key.includes(email), false);
    assert.equal(pair.points, 1);
    assert.ok(Math.abs(Number(pair.expire) - Date.now() - 90 * DAY_MS) < 60_000, "the run lasts 90 days");
    const [ip] = await rowsOf("_fail_ip_per_day:10.0.0.4");
    assert.equal(ip.points, 1);
    assert.ok(Math.abs(Number(ip.expire) - Date.now() - DAY_MS) < 60_000, "the IP's count lasts a day");
  });

test("a blocked pair's row carries the block, an hour from the try that went over", { skip }, async () =>
  {
    const josh = typed(`josh-${randomUUID()}@example.com`);
    for(let i = 0; i < MAX_FAILS_IN_A_ROW + 1; i++) await serverA.countTry(josh, "10.0.0.5");
    const [pair] = await rowsOf(serverA.keyOf(josh, "10.0.0.5"));
    assert.equal(pair.points, MAX_FAILS_IN_A_ROW + 1);
    assert.ok(Math.abs(Number(pair.expire) - Date.now() - HOUR * 1000) < 60_000);
  });

test("through the real route on two servers, 30 wrong passwords at once: at most 10 are checked, the rest get 429", { skip }, async () =>
  {
    const email = `josh-${randomUUID()}@example.com`;
    const asked = [];
    // Each server's password check stands in for PasswordSignIn, slow like argon2, so all 30 are in flight together.
    const startServer = async (limits) =>
      {
        const passport = new Passport();
        const attempt = async () =>
          {
            asked.push(1);
            await new Promise((resolve) => setTimeout(resolve, 20));
            return { reason: "wrong" };
          };
        new PassportSetup({ passport, settings: { isConfigured: () => false }, signIn: {}, logins: {}, passwords: { attempt } }).install();
        const server = express();
        server.use(express.json());
        server.use(session({ secret: "test-secret-test-secret-test-secret", resave: false, saveUninitialized: false }));
        server.use(passport.authenticate("session"));
        server.use("/api/auth", authRoutes(new AuthController({ passport, settings: {}, limits })));
        return new Promise((resolve) =>
          {
            const listening = server.listen(0, "127.0.0.1", () => resolve(listening));
          });
      };
    // Their own prefix, so 127.0.0.1's daily count here starts at 0 and never touches other tests' or the server's.
    const routePrefix = `${prefix}_route`;
    const apps = [await startServer(LoginLimits.inPostgres({ pool: poolA, prefix: routePrefix })), await startServer(LoginLimits.inPostgres({ pool: poolB, prefix: routePrefix }))];
    try
      {
        const tries = Array.from({ length: 30 }, (_, i) => fetch(`http://127.0.0.1:${apps[i % 2].address().port}/api/auth/login`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email, password: "wrong" }),
          }).then((res) => ({ status: res.status, wait: Number(res.headers.get("retry-after")) })));
        const answers = await Promise.all(tries);
        const codes = answers.map((answer) => answer.status);
        assert.equal(asked.length, MAX_FAILS_IN_A_ROW);
        assert.ok(answers.filter((answer) => answer.status === 429).every((answer) => answer.wait > HOUR - 5 && answer.wait <= HOUR), "every 429 says about an hour");
        assert.equal(codes.filter((code) => code === 401).length, MAX_FAILS_IN_A_ROW);
        assert.equal(codes.filter((code) => code === 429).length, 30 - MAX_FAILS_IN_A_ROW);
      }
    finally
      {
        apps.forEach((app) => app.close());
      }
  });
