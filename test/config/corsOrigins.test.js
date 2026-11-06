import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cors from "cors";
import { corsOrigins } from "../../src/config/corsOrigins.js";

const servers = [];

// A tiny API behind the same cors() line as app.js, and what a page on `origin` gets back from it.
const askFrom = async (clientUrl, origin) =>
  {
    const app = express();
    app.use(cors({ origin: corsOrigins(clientUrl), credentials: true }));
    app.get("/api/jobs", (req, res) => res.json([{ company: "Stripe" }]));
    const server = await new Promise((resolve) =>
      {
        const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
      });
    servers.push(server);
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/jobs`, { headers: { origin } });
    return { allowOrigin: res.headers.get("access-control-allow-origin"), credentials: res.headers.get("access-control-allow-credentials") };
  };

after(() =>
  {
    for(const server of servers) server.close();
  });

test("an empty or missing CLIENT_URL lets no other site in, not every site", async () =>
  {
    assert.deepEqual(corsOrigins(""), []);
    assert.deepEqual(corsOrigins(undefined), []);
    assert.deepEqual(corsOrigins(" , "), []);
    assert.equal((await askFrom("", "https://evil.example")).allowOrigin, null);
    assert.equal((await askFrom(undefined, "http://localhost:5173")).allowOrigin, null);
  });

test("the board's own origin gets through with cookies; anyone else doesn't", async () =>
  {
    const board = await askFrom("http://localhost:5173", "http://localhost:5173");
    assert.equal(board.allowOrigin, "http://localhost:5173");
    assert.equal(board.credentials, "true");
    assert.equal((await askFrom("http://localhost:5173", "https://evil.example")).allowOrigin, null);
    assert.equal((await askFrom("http://localhost:5173", "http://localhost:6666")).allowOrigin, null);
  });

test("localhost and 127.0.0.1 count as the same Mac on the same port, and lists and paths are cleaned up", () =>
  {
    assert.deepEqual(corsOrigins("http://localhost:5173/"), ["http://localhost:5173", "http://127.0.0.1:5173"]);
    assert.deepEqual(corsOrigins("https://sleekboard.app/jobs, http://127.0.0.1:5174"), ["https://sleekboard.app", "http://localhost:5174", "http://127.0.0.1:5174"]);
  });
