import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { GmailKeys } from "../../src/services/email/GmailKeys.js";
import { OAuthState, StateError, STATE_MS } from "../../src/services/email/OAuthState.js";
import { GoogleAuth, GoogleAuthError, SCOPE } from "../../src/services/email/GoogleAuth.js";
import { GmailTokens } from "../../src/services/email/GmailTokens.js";
import { GmailConnect } from "../../src/services/email/GmailConnect.js";

const secret = crypto.randomBytes(32).toString("base64");
const keys = new GmailKeys(secret);
const reason = (fn) =>
  {
    try
      {
        fn();
        return null;
      }
    catch(error)
      {
        return error instanceof StateError ? error.reason : error.message;
      }
  };

// --- GmailKeys ---

test("a missing or short GMAIL_SECRET is refused", () =>
  {
    assert.throws(() => new GmailKeys(""), /GMAIL_SECRET/);
    assert.throws(() => new GmailKeys(crypto.randomBytes(16).toString("base64")), /at least 32/);
  });

test("a login locks and unlocks, and isn't readable locked", () =>
  {
    const locked = keys.lock("1//refresh-token");
    assert.ok(locked.startsWith("v1."));
    assert.ok(!locked.includes("refresh-token"));
    assert.equal(keys.unlock(locked), "1//refresh-token");
    assert.notEqual(keys.lock("1//refresh-token"), locked);
  });

test("a tampered login, or one locked with another secret, won't unlock", () =>
  {
    const locked = keys.lock("1//refresh-token");
    const parts = locked.split(".");
    parts[3] = Buffer.from("1//someone-else").toString("base64url");
    assert.equal(keys.unlock(parts.join(".")), "");
    assert.equal(new GmailKeys(crypto.randomBytes(32).toString("base64")).unlock(locked), "");
    assert.equal(keys.unlock("plain-text-token"), "");
    assert.equal(keys.unlock(""), "");
  });

// --- OAuthState ---

test("a state reads back once, then it's used up", () =>
  {
    const states = new OAuthState({ keys });
    const { state, nonce } = states.make("me");
    const payload = states.read(state);
    assert.equal(payload.m, "me");
    assert.equal(payload.n, nonce);
    assert.equal(reason(() => states.read(state)), "state_unknown");
  });

test("a forged or bent state is invalid", () =>
  {
    const states = new OAuthState({ keys });
    const { state } = states.make("me");
    const [body, signature] = state.split(".");
    const other = Buffer.from(JSON.stringify({ k: "gmail", m: "someone", n: "x", e: Date.now() + 1e6 })).toString("base64url");
    assert.equal(reason(() => states.read(`${other}.${signature}`)), "invalid_state");
    assert.equal(reason(() => states.read(`${body}.${signature}x`)), "invalid_state");
    assert.equal(reason(() => states.read(body)), "invalid_state");
    assert.equal(reason(() => states.read(undefined)), "invalid_state");
    assert.equal(reason(() => states.read(["a", "b"])), "invalid_state");
    const wrongKind = Buffer.from(JSON.stringify({ k: "cookie", m: "me", n: "x", e: Date.now() + 1e6 })).toString("base64url");
    assert.equal(reason(() => states.read(`${wrongKind}.${keys.sign(wrongKind)}`)), "invalid_state");
  });

test("a state older than 10 minutes has expired", () =>
  {
    const clock = { now: 1_000_000 };
    const states = new OAuthState({ keys, now: () => clock.now });
    const { state } = states.make("me");
    clock.now += STATE_MS + 1;
    assert.equal(reason(() => states.read(state)), "state_expired");
  });

test("a state from before a restart is unknown", () =>
  {
    const { state } = new OAuthState({ keys }).make("me");
    assert.equal(reason(() => new OAuthState({ keys }).read(state)), "state_unknown");
  });

test("a consent link opened in another browser can't finish", () =>
  {
    const states = new OAuthState({ keys });
    const { state, nonce } = states.make("me");
    const payload = states.read(state);
    assert.equal(reason(() => states.checkBrowser(payload, "")), "browser_mismatch");
    assert.equal(reason(() => states.checkBrowser(payload, "someone-elses-nonce")), "browser_mismatch");
    assert.equal(reason(() => states.checkBrowser(payload, nonce)), null);
  });

test("old nonces are forgotten as new states are made", () =>
  {
    const clock = { now: 1_000_000 };
    const states = new OAuthState({ keys, now: () => clock.now });
    states.make("me");
    clock.now += STATE_MS + 1;
    states.make("me");
    assert.equal(states.pending.size, 1);
  });

// --- GoogleAuth ---

const googleWith = (replies) =>
  {
    const asked = [];
    const fetch = async (url, options) =>
      {
        asked.push({ url, body: Object.fromEntries(options.body) });
        const [status, json] = replies.shift();
        return { ok: status === 200, status, json: async () => json };
      };
    return { asked, auth: new GoogleAuth({ clientId: "cid", clientSecret: "csecret", redirectUri: "http://localhost:5050/api/gmail/callback", fetch }) };
  };

test("the consent link asks for read-only Gmail, offline, with the state", () =>
  {
    const url = new URL(googleWith([]).auth.consentUrl("st.ate"));
    assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(url.searchParams.get("scope"), SCOPE);
    assert.equal(SCOPE, "https://www.googleapis.com/auth/gmail.readonly");
    assert.equal(url.searchParams.get("access_type"), "offline");
    assert.equal(url.searchParams.get("prompt"), "consent");
    assert.equal(url.searchParams.get("state"), "st.ate");
    assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:5050/api/gmail/callback");
  });

test("the code swaps for a refresh token, and a refresh gives an access token", async () =>
  {
    const { auth, asked } = googleWith([[200, { refresh_token: "1//r", access_token: "a1" }], [200, { access_token: "a2", expires_in: 3599 }]]);
    assert.equal(await auth.exchange("code-1"), "1//r");
    assert.deepEqual(await auth.refresh("1//r"), { token: "a2", expiresIn: 3599 });
    assert.deepEqual(asked[0].body, { client_id: "cid", client_secret: "csecret", code: "code-1", grant_type: "authorization_code", redirect_uri: "http://localhost:5050/api/gmail/callback" });
    assert.equal(asked[1].body.grant_type, "refresh_token");
  });

test("a dead login comes back flagged as invalid_grant", async () =>
  {
    const error = await googleWith([[400, { error: "invalid_grant" }]]).auth.refresh("1//r").catch((caught) => caught);
    assert.ok(error instanceof GoogleAuthError);
    assert.equal(error.invalidGrant, true);
    const other = await googleWith([[500, {}]]).auth.refresh("1//r").catch((caught) => caught);
    assert.equal(other.invalidGrant, false);
  });

test("no refresh token from Google is a failure", async () =>
  {
    await assert.rejects(googleWith([[200, { access_token: "a" }]]).auth.exchange("c"), /refresh token/);
  });

// --- GmailTokens ---

// A mailbox in memory with the store's calls.
const mailboxWith = (fields = {}) =>
  {
    const box = { processed: ["old"], resting: [], caughtUp: true, login: "", address: "", expired: "", ...fields };
    return {
      box,
      get: async () => ({ ...box }),
      connect: async (login, address) => Object.assign(box, { login, address, expired: "" }, box.address !== address ? { processed: [], caughtUp: false } : {}),
      disconnect: async () => Object.assign(box, { login: "", address: "", expired: "" }),
      markExpired: async (fingerprint) => Object.assign(box, { expired: fingerprint }),
    };
  };

const authWith = (refresh) => ({ configured: () => true, refresh, calls: 0 });

test("no login is none, and no access token", async () =>
  {
    const tokens = new GmailTokens({ mailbox: mailboxWith(), auth: authWith(async () => ({ token: "a", expiresIn: 3600 })), keys });
    assert.deepEqual(await tokens.status(), { status: "none", configured: true, address: "" });
    assert.equal(await tokens.access(), "");
    assert.equal(await tokens.connected(), false);
  });

test("a saved login is connected, locked in the mailbox, and gives an access token", async () =>
  {
    const mailbox = mailboxWith();
    const tokens = new GmailTokens({ mailbox, auth: authWith(async () => ({ token: "a1", expiresIn: 3600 })), keys });
    await tokens.save("1//r", "josh@gmail.com");
    assert.ok(!mailbox.box.login.includes("1//r"));
    assert.deepEqual(await tokens.status(), { status: "connected", configured: true, address: "josh@gmail.com" });
    assert.equal(await tokens.access(), "a1");
  });

test("the access token is reused until a minute before it runs out", async () =>
  {
    const clock = { now: 0 };
    let calls = 0;
    const auth = authWith(async () => ({ token: `a${++calls}`, expiresIn: 3600 }));
    const tokens = new GmailTokens({ mailbox: mailboxWith({ login: keys.lock("1//r") }), auth, keys, now: () => clock.now });
    assert.equal(await tokens.access(), "a1");
    clock.now = 58 * 60_000;
    assert.equal(await tokens.access(), "a1");
    clock.now = 59 * 60_000 + 1;
    assert.equal(await tokens.access(), "a2");
  });

test("a login Google refuses is marked expired, and Google isn't asked again", async () =>
  {
    let calls = 0;
    const auth = authWith(async () =>
      {
        calls++;
        throw new GoogleAuthError("dead", { invalidGrant: true });
      });
    const mailbox = mailboxWith({ login: keys.lock("1//r") });
    const tokens = new GmailTokens({ mailbox, auth, keys });
    assert.equal(await tokens.access(), "");
    assert.equal(mailbox.box.expired, keys.fingerprint("1//r"));
    assert.equal((await tokens.status()).status, "expired");
    assert.equal(await tokens.access(), "");
    assert.equal(calls, 1);
  });

test("reconnecting clears the expired mark", async () =>
  {
    const mailbox = mailboxWith({ login: keys.lock("1//old"), expired: keys.fingerprint("1//old"), address: "josh@gmail.com" });
    const tokens = new GmailTokens({ mailbox, auth: authWith(async () => ({ token: "a", expiresIn: 3600 })), keys });
    await tokens.save("1//new", "josh@gmail.com");
    assert.equal((await tokens.status()).status, "connected");
    assert.deepEqual(mailbox.box.processed, ["old"]);
  });

test("a hiccup from Google doesn't mark the login expired", async () =>
  {
    const mailbox = mailboxWith({ login: keys.lock("1//r") });
    const auth = authWith(async () =>
      {
        throw new GoogleAuthError("Google refused the login (500).");
      });
    const warn = console.warn;
    console.warn = () => {};
    try
      {
        assert.equal(await new GmailTokens({ mailbox, auth, keys }).access(), "");
      }
    finally
      {
        console.warn = warn;
      }
    assert.equal(mailbox.box.expired, "");
  });

test("without GMAIL_SECRET nothing's set up or connected", async () =>
  {
    const tokens = new GmailTokens({ mailbox: mailboxWith({ login: "v1.x.y.z" }), auth: authWith(async () => ({ token: "a", expiresIn: 3600 })), keys: null });
    assert.deepEqual(await tokens.status(), { status: "none", configured: false, address: "" });
    assert.equal(await tokens.access(), "");
  });

test("disconnecting forgets the login", async () =>
  {
    const mailbox = mailboxWith();
    const tokens = new GmailTokens({ mailbox, auth: authWith(async () => ({ token: "a", expiresIn: 3600 })), keys });
    await tokens.save("1//r", "josh@gmail.com");
    await tokens.forget();
    assert.equal((await tokens.status()).status, "none");
    assert.equal(mailbox.box.login, "");
  });

// --- GmailConnect ---

const connectWith = ({ exchange = async () => "1//r", profile = async () => ({ emailAddress: "josh@gmail.com" }), configured = true } = {}) =>
  {
    const saved = [];
    const states = new OAuthState({ keys });
    const auth = { consentUrl: (state) => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`, exchange, refresh: async () => ({ token: "a", expiresIn: 3600 }) };
    const tokens = { configured: () => configured, save: async (login, address) => saved.push({ login, address }), forget: async () => {} };
    return { saved, states, connect: new GmailConnect({ auth, states, tokens, gmail: { profile } }) };
  };

test("start hands back Google's link and the browser's nonce", () =>
  {
    const { connect } = connectWith();
    const { url, nonce } = connect.start();
    assert.match(url, /^https:\/\/accounts\.google\.com\//);
    assert.ok(nonce.length > 10);
  });

test("start is a 503 until .env has everything", () =>
  {
    assert.throws(() => connectWith({ configured: false }).connect.start(), (error) => error.status === 503 && /GMAIL_SECRET/.test(error.message));
  });

test("finishing saves the login with its address", async () =>
  {
    const { connect, saved } = connectWith();
    const { url, nonce } = connect.start();
    const state = new URL(url).searchParams.get("state");
    assert.deepEqual(await connect.finish({ code: "c", state, nonce }), { ok: true, address: "josh@gmail.com" });
    assert.deepEqual(saved, [{ login: "1//r", address: "josh@gmail.com" }]);
  });

test("a callback from another browser, a replay, or a made-up state saves nothing", async () =>
  {
    const { connect, saved } = connectWith();
    const { url, nonce } = connect.start();
    const state = new URL(url).searchParams.get("state");
    assert.deepEqual(await connect.finish({ code: "c", state, nonce: "not-mine" }), { ok: false, reason: "browser_mismatch" });
    assert.deepEqual(await connect.finish({ code: "c", state, nonce }), { ok: false, reason: "state_unknown" });
    assert.deepEqual(await connect.finish({ code: "c", state: "made.up", nonce }), { ok: false, reason: "invalid_state" });
    assert.deepEqual(saved, []);
  });

test("saying no on Google's screen, or no code, saves nothing", async () =>
  {
    const { connect, saved } = connectWith();
    const first = connect.start();
    assert.deepEqual(await connect.finish({ error: "access_denied", state: new URL(first.url).searchParams.get("state"), nonce: first.nonce }), { ok: false, reason: "access_denied" });
    const second = connect.start();
    assert.deepEqual(await connect.finish({ state: new URL(second.url).searchParams.get("state"), nonce: second.nonce }), { ok: false, reason: "no_code" });
    assert.deepEqual(saved, []);
  });

test("a code Google won't swap saves nothing", async () =>
  {
    const { connect, saved } = connectWith({ exchange: async () => { throw new Error("invalid_grant"); } });
    const { url, nonce } = connect.start();
    const warn = console.warn;
    console.warn = () => {};
    try
      {
        assert.deepEqual(await connect.finish({ code: "c", state: new URL(url).searchParams.get("state"), nonce }), { ok: false, reason: "exchange_failed" });
      }
    finally
      {
        console.warn = warn;
      }
    assert.deepEqual(saved, []);
  });

test("an address Gmail won't give doesn't stop the connection", async () =>
  {
    const { connect, saved } = connectWith({ profile: async () => { throw new Error("403"); } });
    const { url, nonce } = connect.start();
    assert.deepEqual(await connect.finish({ code: "c", state: new URL(url).searchParams.get("state"), nonce }), { ok: true, address: "" });
    assert.deepEqual(saved, [{ login: "1//r", address: "" }]);
  });

test("drop forgets the access token, so the next one comes from Google", async () =>
  {
    let calls = 0;
    const tokens = new GmailTokens({ mailbox: mailboxWith({ login: keys.lock("1//r") }), auth: authWith(async () => ({ token: `a${++calls}`, expiresIn: 3600 })), keys });
    assert.equal(await tokens.access(), "a1");
    tokens.drop();
    assert.equal(await tokens.access(), "a2");
  });
