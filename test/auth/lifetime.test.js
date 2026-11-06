import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionLifetime } from "../../src/services/auth/SessionLifetime.js";
import { CappedPgStore } from "../../src/config/CappedPgStore.js";
import { AuthSettings } from "../../src/services/auth/AuthSettings.js";

const DAY_MS = 24 * 60 * 60_000;
const MAX_MS = 30 * DAY_MS;

const lifetime = new SessionLifetime({ settings: new AuthSettings({ env: {} }) });

// A signed-in session as express-session hands it to the store, stamped `ago` ms back.
const signedIn = (ago, cookie = {}) => ({ cookie: { originalMaxAge: null, expires: null, ...cookie }, passport: { user: "u1" }, signedInAt: Date.now() - ago });

// A store that never reaches a database: only capped() is called.
const store = () => new CappedPgStore({ lifetime, pool: {}, pruneSessionInterval: false, ttl: DAY_MS / 1000 });

// Stands in for the sessions table: one row (or none), noting every query the store sends.
class OneRowPool
  {
    constructor(sess, failure = null)
      {
        this.sess = sess;
        this.failure = failure;
        this.queries = [];
      }

    async query(sql)
      {
        this.queries.push(sql.split(" ")[0]);
        if(this.failure) throw this.failure;
        if(sql.startsWith("SELECT")) return { rows: this.sess ? [{ sess: this.sess }] : [] };
        return { rows: [] };
      }
  }

// What the store's get handed express-session for this row, and which queries it sent.
const loaded = (sess, failure) => new Promise((resolve) =>
  {
    const pool = new OneRowPool(sess, failure);
    const reading = new CappedPgStore({ lifetime, pool, pruneSessionInterval: false });
    reading.get("sid", (error, found) => resolve({ error, found, queries: pool.queries }));
  });

// --- SessionLifetime ---

test("a sign-in lasts 30 days from its stamp, used or not", () =>
  {
    assert.equal(new AuthSettings({ env: {} }).signedInMaxMs(), MAX_MS);
    const sess = signedIn(0);
    assert.equal(lifetime.endOf(sess), sess.signedInAt + MAX_MS);
  });

test("stamp puts the sign-in time in the session itself", () =>
  {
    const session = {};
    const before = Date.now();
    lifetime.stamp(session);
    assert.ok(session.signedInAt >= before && session.signedInAt <= Date.now());
  });

test("a fresh sign-in hasn't run out; one past 30 days has", () =>
  {
    assert.equal(lifetime.hasRunOut(signedIn(29 * DAY_MS)), false);
    assert.equal(lifetime.hasRunOut(signedIn(MAX_MS - 60_000)), false);
    assert.equal(lifetime.hasRunOut(signedIn(MAX_MS)), true);
    assert.equal(lifetime.hasRunOut(signedIn(MAX_MS + 1)), true);
  });

test("a signed-in session with no stamp, or one that isn't a number, counts as run out", () =>
  {
    const { signedInAt, ...unstamped } = signedIn(0);
    assert.equal(lifetime.hasRunOut(unstamped), true);
    assert.equal(lifetime.hasRunOut({ ...unstamped, signedInAt: "2026-11-06" }), true);
    assert.equal(lifetime.hasRunOut({ ...unstamped, signedInAt: null }), true);
    assert.equal(lifetime.endOf(unstamped), null);
  });

test("a session nobody signed in to is never ended by it, stamp or not", () =>
  {
    assert.equal(lifetime.hasRunOut({ cookie: {} }), false);
    assert.equal(lifetime.hasRunOut({ cookie: {}, passport: {} }), false);
    assert.equal(lifetime.hasRunOut(undefined), false);
  });

// --- CappedPgStore ---

test("the store loads a live sign-in as it is and deletes nothing", async () =>
  {
    const sess = signedIn(DAY_MS);
    const { error, found, queries } = await loaded(sess);
    assert.equal(error, null);
    assert.deepEqual(found, sess);
    assert.deepEqual(queries, ["SELECT"]);
  });

test("the store deletes a sign-in past its 30 days and loads it as no session", async () =>
  {
    const { error, found, queries } = await loaded(signedIn(MAX_MS + 1));
    assert.equal(error, null);
    assert.equal(found, undefined);
    assert.deepEqual(queries, ["SELECT", "DELETE"]);
  });

test("the store deletes a signed-in session with no stamp the same way", async () =>
  {
    const { signedInAt, ...unstamped } = signedIn(0);
    const { found, queries } = await loaded(unstamped);
    assert.equal(found, undefined);
    assert.deepEqual(queries, ["SELECT", "DELETE"]);
  });

test("the store leaves a session nobody signed in to, and a missing row, alone", async () =>
  {
    const state = { cookie: {}, oauth2: { state: "x" } };
    assert.deepEqual((await loaded(state)).found, state);
    const missing = await loaded(null);
    assert.equal(missing.found, undefined);
    assert.deepEqual(missing.queries, ["SELECT"]);
  });

test("a database error while reading is handed on as it is", async () =>
  {
    const { error, queries } = await loaded(signedIn(MAX_MS + 1), new Error("db down"));
    assert.equal(error.message, "db down");
    assert.deepEqual(queries, ["SELECT"]);
  });

test("the store leaves a session with no stamp as it is", () =>
  {
    const sess = { cookie: { expires: new Date(Date.now() + 90 * DAY_MS) } };
    assert.equal(store().capped(sess), sess);
  });

test("a ticked row that ends before the sign-in's end is left as it is", () =>
  {
    const sess = signedIn(DAY_MS, { originalMaxAge: MAX_MS, expires: new Date(Date.now() + MAX_MS - 2 * DAY_MS) });
    assert.equal(store().capped(sess), sess);
  });

test("a ticked row that would end after the sign-in's end is cut back to it, in whole seconds", () =>
  {
    const sess = signedIn(10 * DAY_MS, { originalMaxAge: MAX_MS, expires: new Date(Date.now() + MAX_MS) });
    const capped = store().capped(sess);
    const end = sess.signedInAt + MAX_MS;
    assert.equal(capped.cookie.expires.valueOf(), Math.floor(end / 1000) * 1000);
    assert.ok(capped.cookie.expires.valueOf() <= end);
    assert.equal(capped.cookie.originalMaxAge, MAX_MS, "the cookie's length stays, so express-session works the date out again");
    assert.equal(capped.signedInAt, sess.signedInAt);
    assert.deepEqual(capped.passport, sess.passport);
    assert.notEqual(capped, sess);
    assert.ok(sess.cookie.expires.valueOf() > end, "the session itself is left alone");
  });

test("an unticked row keeps its day, until the sign-in's end is nearer than a day", () =>
  {
    const early = signedIn(DAY_MS);
    assert.equal(store().capped(early), early);
    const late = signedIn(MAX_MS - 60 * 60_000);
    const capped = store().capped(late);
    assert.ok(capped.cookie.expires.valueOf() <= late.signedInAt + MAX_MS);
    assert.ok(capped.cookie.expires.valueOf() > Date.now() + 59 * 60_000);
    assert.equal(capped.cookie.originalMaxAge, null, "the browser's cookie stays dateless");
    assert.equal(late.cookie.expires, null);
  });

test("express-session's own Cookie is copied through toJSON, so its date isn't lost in a getter", () =>
  {
    class Cookie
      {
        constructor()
          {
            this._expires = new Date(Date.now() + MAX_MS);
            this.originalMaxAge = MAX_MS;
            this.path = "/";
          }

        get expires()
          {
            return this._expires;
          }

        toJSON()
          {
            return { originalMaxAge: this.originalMaxAge, expires: this._expires, path: this.path };
          }
      }
    const sess = { cookie: new Cookie(), passport: { user: "u1" }, signedInAt: Date.now() - DAY_MS };
    const capped = store().capped(sess);
    assert.deepEqual(Object.keys(capped.cookie).sort(), ["expires", "originalMaxAge", "path"]);
    assert.ok(capped.cookie.expires.valueOf() <= sess.signedInAt + MAX_MS);
  });
