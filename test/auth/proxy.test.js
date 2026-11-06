import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { AuthSettings } from "../../src/services/auth/AuthSettings.js";

const SECRET = "x".repeat(43);
const CLOUD_RUN = { SESSION_SECRET: SECRET, K_SERVICE: "sleekboard-server", CLIENT_URL: "https://sleekboard.app" };

const hopsFor = (env) => new AuthSettings({ env }).trustProxyHops();

// --- AuthSettings.trustProxyHops ---

test("unset, the hop count is 1 on Cloud Run and 0 anywhere else", () =>
  {
    assert.equal(hopsFor({}), 0);
    assert.equal(hopsFor({ TRUST_PROXY_HOPS: "" }), 0);
    assert.equal(hopsFor({ TRUST_PROXY_HOPS: "  " }), 0);
    assert.equal(hopsFor({ K_SERVICE: "sleekboard-server" }), 1);
  });

test("a whole number from 0 to 5 is taken as a number, on Cloud Run or not", () =>
  {
    assert.equal(hopsFor({ TRUST_PROXY_HOPS: "2", K_SERVICE: "sleekboard-server" }), 2);
    assert.equal(hopsFor({ TRUST_PROXY_HOPS: " 2 " }), 2);
    assert.equal(hopsFor({ TRUST_PROXY_HOPS: "0" }), 0);
    assert.equal(hopsFor({ TRUST_PROXY_HOPS: "5" }), 5);
    assert.equal(typeof hopsFor({ TRUST_PROXY_HOPS: "1" }), "number");
  });

test("anything else stops the start with a plain sentence", () =>
  {
    for(const bad of ["6", "-1", "1.5", "2.0", "two", "true", "1e1", "0x2", "1,2", "10.0.0.1", "loopback"])
      {
        assert.throws(() => hopsFor({ TRUST_PROXY_HOPS: bad }), /TRUST_PROXY_HOPS has to be a whole number from 0 to 5/, bad);
      }
  });

test("check() stops a Cloud Run start with a bad hop count, or with 0", () =>
  {
    assert.throws(() => new AuthSettings({ env: { ...CLOUD_RUN, TRUST_PROXY_HOPS: "9" } }).check(), /whole number from 0 to 5/);
    assert.throws(() => new AuthSettings({ env: { ...CLOUD_RUN, TRUST_PROXY_HOPS: "0" } }).check(), /can't be 0 on Cloud Run/);
    assert.doesNotThrow(() => new AuthSettings({ env: CLOUD_RUN }).check());
    assert.doesNotThrow(() => new AuthSettings({ env: { ...CLOUD_RUN, TRUST_PROXY_HOPS: "2" } }).check());
    assert.doesNotThrow(() => new AuthSettings({ env: { SESSION_SECRET: SECRET, TRUST_PROXY_HOPS: "0" } }).check());
  });

// --- req.ip through X-Forwarded-For ---

// A tiny app set up the way app.js does it, answering with the req.ip Express worked out.
const startApp = async (env) =>
  {
    const server = express();
    server.set("trust proxy", new AuthSettings({ env }).trustProxyHops());
    server.get("/ip", (req, res) => res.json({ ip: req.ip }));
    const app = await new Promise((resolve) =>
      {
        const listening = server.listen(0, "127.0.0.1", () => resolve(listening));
      });
    const ipFor = async (forwardedFor) =>
      {
        const headers = forwardedFor ? { "x-forwarded-for": forwardedFor } : {};
        const answer = await fetch(`http://127.0.0.1:${app.address().port}/ip`, { headers });
        return (await answer.json()).ip;
      };
    return { app, ipFor };
  };

// Documentation addresses (RFC 5737): 203.0.113.x a visitor, 104.16.0.1 standing in for Cloudflare, 6.6.6.6 made up.
test("plain Cloud Run (1 hop): req.ip is the address Google's front end added last, whatever the visitor typed before it", async () =>
  {
    const { app, ipFor } = await startApp({ K_SERVICE: "sleekboard-server" });
    try
      {
        assert.equal(await ipFor("203.0.113.9"), "203.0.113.9");
        assert.equal(await ipFor("6.6.6.6, 203.0.113.9"), "203.0.113.9");
        assert.equal(await ipFor("6.6.6.6,198.51.100.4, 203.0.113.9"), "203.0.113.9");
      }
    finally
      {
        app.close();
      }
  });

test("Cloudflare in front (2 hops): req.ip is the visitor Cloudflare saw, not Cloudflare and not a made-up entry", async () =>
  {
    const { app, ipFor } = await startApp({ K_SERVICE: "sleekboard-server", TRUST_PROXY_HOPS: "2" });
    try
      {
        // Cloudflare writes the visitor, then Google's front end adds Cloudflare's address.
        assert.equal(await ipFor("203.0.113.9, 104.16.0.1"), "203.0.113.9");
        // The visitor sent their own header: Cloudflare appends after it, so the made-up part is skipped.
        assert.equal(await ipFor("6.6.6.6, 203.0.113.9, 104.16.0.1"), "203.0.113.9");
      }
    finally
      {
        app.close();
      }
  });

test("a hop count higher than what's really in front lets the visitor pick their own address", async () =>
  {
    // 2 hops set, but the request came straight to Cloud Run: only Google's front end added an entry.
    const { app, ipFor } = await startApp({ K_SERVICE: "sleekboard-server", TRUST_PROXY_HOPS: "2" });
    try
      {
        assert.equal(await ipFor("6.6.6.6, 203.0.113.9"), "6.6.6.6");
      }
    finally
      {
        app.close();
      }
  });

test("off Cloud Run (0 hops) the header is ignored and req.ip is whoever connected", async () =>
  {
    const { app, ipFor } = await startApp({});
    try
      {
        assert.equal(await ipFor("6.6.6.6"), "127.0.0.1");
        assert.equal(await ipFor(""), "127.0.0.1");
      }
    finally
      {
        app.close();
      }
  });
