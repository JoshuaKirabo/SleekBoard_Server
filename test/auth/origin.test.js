import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { AuthSettings } from "../../src/services/auth/AuthSettings.js";
import { OriginLock, ORIGIN_HEADER } from "../../src/middleware/OriginLock.js";

const SECRET = "x".repeat(43);
const ORIGIN = "o".repeat(43);
const CLOUD_RUN = { SESSION_SECRET: SECRET, K_SERVICE: "sleekboard-server", CLIENT_URL: "https://sleekboard.app" };

const secretFor = (env) => new AuthSettings({ env }).originSecret();

// --- AuthSettings.originSecret: when the lock is on, and when the start stops ---

test("off Cloud Run with no secret the lock is off, so this Mac works as it is", () =>
  {
    assert.equal(secretFor({}), "");
    assert.equal(secretFor({ ORIGIN_SECRET: "   " }), "");
  });

test("a secret of 32+ characters turns the lock on, on Cloud Run or not, trimmed", () =>
  {
    assert.equal(secretFor({ ORIGIN_SECRET: ORIGIN }), ORIGIN);
    assert.equal(secretFor({ ...CLOUD_RUN, ORIGIN_SECRET: ORIGIN }), ORIGIN);
    assert.equal(secretFor({ ORIGIN_SECRET: `${ORIGIN}\n` }), ORIGIN);
    assert.equal(secretFor({ ORIGIN_SECRET: "a".repeat(32) }), "a".repeat(32));
  });

test("a short secret stops the start, anywhere", () =>
  {
    assert.throws(() => secretFor({ ORIGIN_SECRET: "a".repeat(31) }), /ORIGIN_SECRET is too short/);
    assert.throws(() => secretFor({ ...CLOUD_RUN, ORIGIN_SECRET: "hunter2" }), /ORIGIN_SECRET is too short/);
  });

test("on Cloud Run a missing secret stops the start, unless ORIGIN_LOCK=off says so on purpose", () =>
  {
    assert.throws(() => secretFor(CLOUD_RUN), /ORIGIN_SECRET has to be set on Cloud Run/);
    assert.equal(secretFor({ ...CLOUD_RUN, ORIGIN_LOCK: "off" }), "");
    assert.equal(secretFor({ ...CLOUD_RUN, ORIGIN_LOCK: " off " }), "");
    assert.doesNotThrow(() => new AuthSettings({ env: { ...CLOUD_RUN, ORIGIN_LOCK: "off" } }).check());
    assert.doesNotThrow(() => new AuthSettings({ env: { ...CLOUD_RUN, ORIGIN_SECRET: ORIGIN } }).check());
  });

test("ORIGIN_LOCK takes only \"off\": anything else stops the start", () =>
  {
    for(const bad of ["of", "OFF", "false", "0", "no", "on"])
      {
        assert.throws(() => secretFor({ ...CLOUD_RUN, ORIGIN_SECRET: ORIGIN, ORIGIN_LOCK: bad }), /ORIGIN_LOCK only takes "off"/, bad);
      }
  });

test("ORIGIN_LOCK=off wins over a secret that's set", () =>
  {
    assert.equal(secretFor({ ...CLOUD_RUN, ORIGIN_SECRET: ORIGIN, ORIGIN_LOCK: "off" }), "");
  });

test("check() won't trust two hops on Cloud Run with the lock off, since direct requests could fake req.ip", () =>
  {
    assert.throws(() => new AuthSettings({ env: { ...CLOUD_RUN, ORIGIN_LOCK: "off", TRUST_PROXY_HOPS: "2" } }).check(), /TRUST_PROXY_HOPS above 1 needs the origin lock on/);
    assert.doesNotThrow(() => new AuthSettings({ env: { ...CLOUD_RUN, ORIGIN_LOCK: "off", TRUST_PROXY_HOPS: "1" } }).check());
    assert.doesNotThrow(() => new AuthSettings({ env: { ...CLOUD_RUN, ORIGIN_SECRET: ORIGIN, TRUST_PROXY_HOPS: "2" } }).check());
    // This Mac has no Google front end, so the hop count there is whatever you're testing.
    assert.doesNotThrow(() => new AuthSettings({ env: { SESSION_SECRET: SECRET, TRUST_PROXY_HOPS: "2" } }).check());
  });

// --- OriginLock.admits ---

test("the lock admits the secret and nothing else: missing, wrong, longer, shorter, or a different case", () =>
  {
    const lock = new OriginLock({ secret: ORIGIN });
    assert.equal(lock.admits(ORIGIN), true);
    assert.equal(lock.admits(undefined), false);
    assert.equal(lock.admits(""), false);
    assert.equal(lock.admits("o".repeat(42)), false);
    assert.equal(lock.admits(`${ORIGIN}o`), false);
    assert.equal(lock.admits(ORIGIN.toUpperCase()), false);
    assert.equal(lock.admits(`${ORIGIN}, ${ORIGIN}`), false);
    assert.equal(lock.admits("y".repeat(10_000)), false);
  });

// --- The lock in front of an app ---

const listen = (server) => new Promise((resolve) =>
  {
    const listening = server.listen(0, "127.0.0.1", () => resolve(listening));
  });

// A tiny app laid out like app.js: the lock, then body parsing, then a route that notes it was reached.
const startLocked = async () =>
  {
    const reached = [];
    const server = express();
    server.use(new OriginLock({ secret: ORIGIN }).guard());
    server.use(express.json());
    server.post("/api/thing", (req, res) =>
      {
        reached.push(req.body);
        res.json({ ok: true });
      });
    const app = await listen(server);
    const post = (headers, body) => fetch(`http://127.0.0.1:${app.address().port}/api/thing`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
    return { app, reached, post };
  };

test("without the header, or with a wrong one, it's a bare 403 before the body is even read", async () =>
  {
    const { app, reached, post } = await startLocked();
    try
      {
        // Broken JSON would be a 400 from express.json; a 403 means the lock answered first.
        for(const headers of [{}, { [ORIGIN_HEADER]: "wrong" }, { [ORIGIN_HEADER]: "" }])
          {
            const answer = await post(headers, "{ not json");
            assert.equal(answer.status, 403);
            assert.equal(await answer.text(), "Forbidden");
          }
        assert.deepEqual(reached, []);
      }
    finally
      {
        app.close();
      }
  });

test("with the right header the request goes on to the route", async () =>
  {
    const { app, reached, post } = await startLocked();
    try
      {
        const answer = await post({ "X-Origin-Secret": ORIGIN }, JSON.stringify({ a: 1 }));
        assert.equal(answer.status, 200);
        assert.deepEqual(reached, [{ a: 1 }]);
      }
    finally
      {
        app.close();
      }
  });

// --- The real app.js ---

// The whole server's app, loaded with the lock on. The database address is never dialled: the paths asked for here
// stop at the lock, or at the 404 that needs no database.
const loadApp = async () =>
  {
    process.env.ORIGIN_SECRET = ORIGIN;
    process.env.CLIENT_URL = "https://sleekboard.app";
    process.env.DATABASE_URL ||= "postgresql://nobody@localhost:1/never_used";
    process.env.SESSION_SECRET ||= SECRET;
    const { default: app } = await import("../../src/app.js");
    return listen(app);
  };

test("app.js turns away a request without the header before any route, preflights included", async () =>
  {
    const app = await loadApp();
    const base = `http://127.0.0.1:${app.address().port}`;
    try
      {
        // /api/health would ask Postgres; the lock answers first.
        const health = await fetch(`${base}/api/health`);
        assert.equal(health.status, 403);
        assert.equal(await health.text(), "Forbidden");

        const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: "{ not json" });
        assert.equal(login.status, 403);

        const preflight = await fetch(`${base}/api/jobs`, { method: "OPTIONS", headers: { origin: "https://sleekboard.app", "access-control-request-method": "PATCH" } });
        assert.equal(preflight.status, 403);
        assert.equal(preflight.headers.get("access-control-allow-origin"), null);

        // With Cloudflare's header the same preflight gets CORS' answer, and an unknown path the usual 404.
        const passed = await fetch(`${base}/api/jobs`, { method: "OPTIONS", headers: { origin: "https://sleekboard.app", "access-control-request-method": "PATCH", [ORIGIN_HEADER]: ORIGIN } });
        assert.equal(passed.status, 204);
        assert.equal(passed.headers.get("access-control-allow-origin"), "https://sleekboard.app");
        assert.equal((await fetch(`${base}/nowhere`, { headers: { [ORIGIN_HEADER]: ORIGIN } })).status, 404);
      }
    finally
      {
        app.close();
      }
  });
