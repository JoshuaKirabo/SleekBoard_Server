import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import { Passport } from "passport";
import { LoginLimits, MAX_FAILS_IN_A_ROW, MAX_FAILS_PER_IP_PER_DAY } from "../../src/services/auth/LoginLimits.js";
import { PasswordLogin } from "../../src/services/auth/PasswordLogin.js";
import { PassportSetup } from "../../src/services/auth/PassportSetup.js";
import { AuthController, WRONG_LOGIN, LIMITS_DOWN } from "../../src/controllers/auth.controller.js";
import { authRoutes } from "../../src/routes/auth.router.js";

// Failed email + password sign-ins, counted after rate-limiter-flexible's "Login endpoint protection": 10 in a row per
// email + IP blocks that pair for an hour, 100 a day per IP blocks the IP for a day, a right password clears the pair.
// All on the library's memory store, through the same LoginLimits class the server runs on Postgres.
const HOUR = 60 * 60;
const DAY = 24 * HOUR;

const typed = (email) => new PasswordLogin({ email, password: "x" });

// Counts `times` tries in a row, keeping what each one answered.
const tryTimes = async (limits, login, ip, times) =>
  {
    const waits = [];
    for(let i = 0; i < times; i++) waits.push(await limits.countTry(login, ip));
    return waits;
  };

// --- LoginLimits ---

test("the wiki's numbers: 10 in a row per email + IP, 100 a day per IP", () =>
  {
    assert.equal(MAX_FAILS_IN_A_ROW, 10);
    assert.equal(MAX_FAILS_PER_IP_PER_DAY, 100);
  });

test("10 tries in a row go ahead; the 11th is turned away and blocks that email from that IP for an hour", async () =>
  {
    const limits = LoginLimits.inMemory();
    const josh = typed("josh@gmail.com");
    assert.deepEqual(await tryTimes(limits, josh, "1.1.1.1", MAX_FAILS_IN_A_ROW), Array(MAX_FAILS_IN_A_ROW).fill(0));
    assert.equal(await limits.countTry(josh, "1.1.1.1"), HOUR);
    const wait = await limits.countTry(josh, "1.1.1.1");
    assert.ok(wait > HOUR - 5 && wait <= HOUR, `still about an hour, not pushed further, got ${wait}`);
  });

test("tries sent all at once can't slip past: of 30 at once, exactly 10 go ahead", async () =>
  {
    const limits = LoginLimits.inMemory();
    const waits = await Promise.all(Array.from({ length: 30 }, () => limits.countTry(typed("josh@gmail.com"), "1.1.1.1")));
    assert.equal(waits.filter((wait) => wait === 0).length, MAX_FAILS_IN_A_ROW);
  });

test("a blocked email + IP doesn't block another email from that IP, or that email from another IP", async () =>
  {
    const limits = LoginLimits.inMemory();
    await tryTimes(limits, typed("josh@gmail.com"), "1.1.1.1", MAX_FAILS_IN_A_ROW + 1);
    assert.ok(await limits.countTry(typed("josh@gmail.com"), "1.1.1.1") > 0);
    assert.equal(await limits.countTry(typed("sam@gmail.com"), "1.1.1.1"), 0);
    assert.equal(await limits.countTry(typed("josh@gmail.com"), "2.2.2.2"), 0);
  });

test("100 tries a day from one IP, over many emails, go ahead; then that IP is blocked for a day, whatever email", async () =>
  {
    const limits = LoginLimits.inMemory();
    // Nine tries each on a run of emails, so no email + IP pair reaches its own limit.
    let waits = [];
    for(let i = 0; waits.length < MAX_FAILS_PER_IP_PER_DAY; i++)
      {
        const left = MAX_FAILS_PER_IP_PER_DAY - waits.length;
        waits = waits.concat(await tryTimes(limits, typed(`person${i}@example.com`), "3.3.3.3", Math.min(9, left)));
      }
    assert.deepEqual(waits, Array(MAX_FAILS_PER_IP_PER_DAY).fill(0));
    assert.equal(await limits.countTry(typed("new@example.com"), "3.3.3.3"), DAY);
    const wait = await limits.countTry(typed("someone-else@example.com"), "3.3.3.3");
    assert.ok(wait > DAY - 5 && wait <= DAY, `about a day, got ${wait}`);
    assert.equal(await limits.countTry(typed("new@example.com"), "4.4.4.4"), 0, "another IP isn't touched");
  });

test("a blocked IP adds no email + IP counts", async () =>
  {
    const limits = LoginLimits.inMemory();
    for(let i = 0; i < MAX_FAILS_PER_IP_PER_DAY + 1; i++) await limits.countTry(typed(`p${i}@example.com`), "3.3.3.3");
    await limits.countTry(typed("fresh@example.com"), "3.3.3.3");
    assert.equal(await limits.byEmailAndIp.get(limits.keyOf(typed("fresh@example.com"), "3.3.3.3")), null);
  });

test("a right password clears the run for that email + IP, so 10 more tries go ahead", async () =>
  {
    const limits = LoginLimits.inMemory();
    const josh = typed("josh@gmail.com");
    await tryTimes(limits, josh, "1.1.1.1", MAX_FAILS_IN_A_ROW);
    await limits.succeeded(josh, "1.1.1.1");
    assert.deepEqual(await tryTimes(limits, josh, "1.1.1.1", MAX_FAILS_IN_A_ROW), Array(MAX_FAILS_IN_A_ROW).fill(0));
  });

test("a right password gives its own point back to the IP, and the IP's failures stay counted", async () =>
  {
    const limits = LoginLimits.inMemory();
    await tryTimes(limits, typed("josh@gmail.com"), "5.5.5.5", 6);
    await limits.succeeded(typed("josh@gmail.com"), "5.5.5.5");
    const count = await limits.byIp.get("5.5.5.5");
    assert.equal(count.consumedPoints, 5);
  });

test("the email in the key is PasswordLogin's (trimmed, lowercase), hashed, and always fits the 255-character column", () =>
  {
    const limits = LoginLimits.inMemory();
    const key = limits.keyOf(typed("josh@gmail.com"), "1.1.1.1");
    assert.equal(limits.keyOf(typed("  JOSH@Gmail.com "), "1.1.1.1"), key);
    assert.match(key, /^[0-9a-f]{64}_1\.1\.1\.1$/);
    assert.equal(key.includes("josh"), false);
    const longest = limits.keyOf(typed(`${"a".repeat(400)}@example.com`), "ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255");
    assert.ok(`${limits.byEmailAndIp.keyPrefix}:${longest}`.length <= 255);
  });

// A limiter whose store is down: every call fails with a plain Error, the way a Postgres error reaches the library.
class BrokenLimiter
  {
    consume()
      {
        return Promise.reject(new Error("connection refused"));
      }

    delete()
      {
        return Promise.reject(new Error("connection refused"));
      }

    reward()
      {
        return Promise.reject(new Error("connection refused"));
      }
  }

// Counts with a working limiter, but can't take a count back: the try goes ahead, then the success can't be recorded.
class NoGiveBackLimiter
  {
    constructor(counts)
      {
        this.counts = counts;
      }

    consume(key)
      {
        return this.counts.consume(key);
      }

    delete()
      {
        return Promise.reject(new Error("disk full"));
      }

    reward()
      {
        return Promise.reject(new Error("disk full"));
      }
  }

test("a store error is thrown, never read as being under the limit", async () =>
  {
    const healthy = LoginLimits.inMemory();
    const pairDown = new LoginLimits({ byIp: healthy.byIp, byEmailAndIp: new BrokenLimiter() });
    await assert.rejects(pairDown.countTry(typed("josh@gmail.com"), "1.1.1.1"), /connection refused/);
    await assert.rejects(pairDown.succeeded(typed("josh@gmail.com"), "1.1.1.1"), /connection refused/);
    const ipDown = new LoginLimits({ byIp: new BrokenLimiter(), byEmailAndIp: healthy.byEmailAndIp });
    await assert.rejects(ipDown.countTry(typed("josh@gmail.com"), "1.1.1.1"), /connection refused/);
    await assert.rejects(ipDown.succeeded(typed("josh@gmail.com"), "1.1.1.1"), /connection refused/);
  });

// --- POST /api/auth/login with limits (AuthController) ---

const OWNER = { id: "u1", email: "josh@gmail.com", name: "Josh" };
const RIGHT = "correct horse";

// The real routes and controller over a PasswordSignIn stand-in (Josh's email, one right password) that counts how
// often it was asked. Tests trust X-Forwarded-For so one test can come from several IPs; the server itself only
// trusts it behind Cloud Run (app.js).
const startApp = async (limits) =>
  {
    const passport = new Passport();
    const asked = [];
    const attempt = async (login) =>
      {
        asked.push(login.password());
        return login.email() === OWNER.email && login.password() === RIGHT ? { user: OWNER } : { reason: "wrong" };
      };
    const settings = { isConfigured: () => false, sessionMs: () => 60_000 };
    new PassportSetup({ passport, settings, signIn: {}, logins: {}, passwords: { attempt } }).install();
    const server = express();
    server.set("trust proxy", true);
    server.use(express.json());
    server.use(session({ secret: "test-secret-test-secret-test-secret", resave: false, saveUninitialized: false }));
    server.use(passport.authenticate("session"));
    server.use("/api/auth", authRoutes(new AuthController({ passport, settings, limits })));
    const app = await new Promise((resolve) =>
      {
        const listening = server.listen(0, "127.0.0.1", () => resolve(listening));
      });
    const logIn = (email, password, ip = "9.9.9.9") => fetch(`http://127.0.0.1:${app.address().port}/api/auth/login`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({ email, password }),
      });
    return { app, logIn, asked };
  };

// Status codes of `times` wrong tries.
const wrongTimes = async (logIn, email, times, ip) =>
  {
    const codes = [];
    for(let i = 0; i < times; i++) codes.push((await logIn(email, "wrong", ip)).status);
    return codes;
  };

test("10 wrong passwords get 401; the 11th gets 429 with Retry-After and a plain message", async () =>
  {
    const { app, logIn } = await startApp(LoginLimits.inMemory());
    try
      {
        assert.deepEqual(await wrongTimes(logIn, OWNER.email, 10), Array(10).fill(401));
        const blocked = await logIn(OWNER.email, "wrong");
        assert.equal(blocked.status, 429);
        assert.equal(blocked.headers.get("retry-after"), String(HOUR));
        assert.deepEqual(await blocked.json(), { message: "Please wait 1 hour before trying again. There have been too many sign-in attempts." });
      }
    finally
      {
        app.close();
      }
  });

test("while blocked, even the right password is turned away with 429 and never checked", async () =>
  {
    const { app, logIn, asked } = await startApp(LoginLimits.inMemory());
    try
      {
        await wrongTimes(logIn, OWNER.email, 11);
        const checks = asked.length;
        const right = await logIn(OWNER.email, RIGHT);
        assert.equal(right.status, 429);
        assert.ok(Number(right.headers.get("retry-after")) > HOUR - 5);
        assert.equal(right.headers.get("set-cookie"), null, "no session");
        assert.equal(asked.length, checks, "the password wasn't checked");
      }
    finally
      {
        app.close();
      }
  });

test("another email from the blocked IP still gets the ordinary 401, and the owner from another IP gets in", async () =>
  {
    const { app, logIn } = await startApp(LoginLimits.inMemory());
    try
      {
        await wrongTimes(logIn, OWNER.email, 11, "9.9.9.9");
        const other = await logIn("sam@gmail.com", "wrong", "9.9.9.9");
        assert.equal(other.status, 401);
        assert.deepEqual(await other.json(), { message: WRONG_LOGIN });
        assert.equal((await logIn(OWNER.email, RIGHT, "8.8.8.8")).status, 200);
      }
    finally
      {
        app.close();
      }
  });

test("a right password resets the run, so the next 10 wrong ones are 401 again", async () =>
  {
    const { app, logIn } = await startApp(LoginLimits.inMemory());
    try
      {
        assert.deepEqual(await wrongTimes(logIn, OWNER.email, 9), Array(9).fill(401));
        assert.equal((await logIn(OWNER.email, RIGHT)).status, 200);
        assert.deepEqual(await wrongTimes(logIn, OWNER.email, 10), Array(10).fill(401));
        assert.equal((await logIn(OWNER.email, "wrong")).status, 429);
      }
    finally
      {
        app.close();
      }
  });

test("100 wrong tries from one IP over many emails block that IP for a day, the right password included", async () =>
  {
    const { app, logIn } = await startApp(LoginLimits.inMemory());
    try
      {
        const codes = [];
        for(let i = 0; i < 100; i++) codes.push((await logIn(`person${Math.floor(i / 5)}@example.com`, "wrong", "7.7.7.7")).status);
        assert.deepEqual(codes, Array(100).fill(401));
        const tipping = await logIn("someone@example.com", "wrong", "7.7.7.7");
        assert.equal(tipping.status, 429);
        assert.equal(tipping.headers.get("retry-after"), String(DAY));
        assert.deepEqual(await tipping.json(), { message: "Please wait 24 hours before trying again. There have been too many sign-in attempts." });
        assert.equal((await logIn(OWNER.email, RIGHT, "7.7.7.7")).status, 429);
        assert.equal((await logIn(OWNER.email, RIGHT, "6.6.6.6")).status, 200);
      }
    finally
      {
        app.close();
      }
  });

test("an empty password (passport-local's own refusal) counts as a wrong try too", async () =>
  {
    const limits = LoginLimits.inMemory();
    const { app, logIn } = await startApp(limits);
    try
      {
        assert.equal((await logIn(OWNER.email, "")).status, 401);
        const count = await limits.byEmailAndIp.get(limits.keyOf(typed(OWNER.email), "9.9.9.9"));
        assert.equal(count.consumedPoints, 1);
      }
    finally
      {
        app.close();
      }
  });

test("when a try can't be counted, sign-in is shut with 503 and the password isn't checked", async () =>
  {
    const healthy = LoginLimits.inMemory();
    const { app, logIn, asked } = await startApp(new LoginLimits({ byIp: new BrokenLimiter(), byEmailAndIp: healthy.byEmailAndIp }));
    const logged = [];
    const error = console.error;
    console.error = (...args) => logged.push(args.join(" "));
    try
      {
        const res = await logIn(OWNER.email, RIGHT);
        assert.equal(res.status, 503);
        assert.deepEqual(await res.json(), { message: LIMITS_DOWN });
        assert.equal(asked.length, 0);
        assert.match(logged.join("\n"), /Sign-in limits couldn't be checked.*connection refused/);
      }
    finally
      {
        console.error = error;
        app.close();
      }
  });

test("when a right password's count can't be given back, the answer is 503 and no session", async () =>
  {
    const healthy = LoginLimits.inMemory();
    const { app, logIn } = await startApp(new LoginLimits({ byIp: healthy.byIp, byEmailAndIp: new NoGiveBackLimiter(healthy.byEmailAndIp) }));
    const error = console.error;
    console.error = () =>
      {
      };
    try
      {
        assert.equal((await logIn(OWNER.email, "wrong")).status, 401, "a wrong one needs nothing given back");
        const right = await logIn(OWNER.email, RIGHT);
        assert.equal(right.status, 503);
        assert.equal(right.headers.get("set-cookie"), null);
      }
    finally
      {
        console.error = error;
        app.close();
      }
  });

test("after 10 wrong passwords the 11th try is turned away unchecked, even with the right password", async () =>
  {
    const { app, logIn, asked } = await startApp(LoginLimits.inMemory());
    try
      {
        await wrongTimes(logIn, OWNER.email, 10);
        const right = await logIn(OWNER.email, RIGHT);
        assert.equal(right.status, 429);
        assert.equal(right.headers.get("retry-after"), String(HOUR));
        assert.equal(asked.length, 10);
      }
    finally
      {
        app.close();
      }
  });

test("wrong passwords sent all at once: at most 10 reach a password check, the rest get 429", async () =>
  {
    const { app, logIn, asked } = await startApp(LoginLimits.inMemory());
    try
      {
        const codes = await Promise.all(Array.from({ length: 25 }, () => logIn(OWNER.email, "wrong").then((res) => res.status)));
        assert.equal(asked.length, MAX_FAILS_IN_A_ROW);
        assert.equal(codes.filter((code) => code === 401).length, MAX_FAILS_IN_A_ROW);
        assert.equal(codes.filter((code) => code === 429).length, 25 - MAX_FAILS_IN_A_ROW);
      }
    finally
      {
        app.close();
      }
  });

test("a controller built without limits shuts email + password sign-in rather than leaving it unlimited", async () =>
  {
    const { app, logIn, asked } = await startApp(undefined);
    const error = console.error;
    console.error = () =>
      {
      };
    try
      {
        assert.equal((await logIn(OWNER.email, RIGHT)).status, 503);
        assert.equal(asked.length, 0);
      }
    finally
      {
        console.error = error;
        app.close();
      }
  });

test("the wait reads as a minute, minutes, or hours, never shorter than Retry-After", () =>
  {
    const controller = new AuthController({ passport: {}, settings: {} });
    assert.equal(controller.waitWords(1), "a minute");
    assert.equal(controller.waitWords(60), "a minute");
    assert.equal(controller.waitWords(61), "2 minutes");
    assert.equal(controller.waitWords(59 * 60 + 1), "1 hour");
    assert.equal(controller.waitWords(HOUR), "1 hour");
    assert.equal(controller.waitWords(HOUR + 1), "2 hours");
    assert.equal(controller.waitWords(DAY), "24 hours");
  });
