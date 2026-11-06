import { test } from "node:test";
import assert from "node:assert/strict";
import { GoogleAccount, GOOGLE } from "../../src/services/auth/GoogleAccount.js";
import { SignInGate } from "../../src/services/auth/SignInGate.js";
import { SignIn } from "../../src/services/auth/SignIn.js";
import { AuthSettings } from "../../src/services/auth/AuthSettings.js";

// A profile the way passport-google-oauth20 builds it from Google's userinfo.
const profile = ({ id = "1001", email = "Josh@Gmail.com", verified = true, name = "Josh" } = {}) =>
  ({ id, displayName: name, emails: email ? [{ value: email, verified }] : undefined });

const SECRET = "x".repeat(43);

// --- GoogleAccount ---

test("a Google account reads its id, lowercase email and name, and vouches as accounts.google.com", () =>
  {
    const account = new GoogleAccount(profile());
    assert.equal(account.provider(), GOOGLE);
    assert.equal(account.subject(), "1001");
    assert.equal(account.email(), "josh@gmail.com");
    assert.equal(account.name(), "Josh");
    assert.equal(account.isVerified(), true);
  });

test("only a real true counts as verified", () =>
  {
    assert.equal(new GoogleAccount(profile({ verified: false })).isVerified(), false);
    assert.equal(new GoogleAccount(profile({ verified: "true" })).isVerified(), false);
    assert.equal(new GoogleAccount(profile({ verified: null })).isVerified(), false);
    assert.equal(new GoogleAccount({ id: "1", emails: [{ value: "josh@gmail.com" }] }).isVerified(), false);
    assert.equal(new GoogleAccount(profile({ email: "" })).isVerified(), false);
    assert.equal(new GoogleAccount(profile({ email: "" })).email(), "");
  });

// --- SignInGate ---

test("the gate lets in the owner's verified email, whatever its case", () =>
  {
    const gate = new SignInGate({ emails: [" JOSH@gmail.com "] });
    assert.equal(gate.admits(new GoogleAccount(profile())), true);
  });

test("the gate turns away other emails, an unverified owner email, and everyone when OWNER_EMAIL is empty", () =>
  {
    const gate = new SignInGate({ emails: ["josh@gmail.com"] });
    assert.equal(gate.admits(new GoogleAccount(profile({ email: "sam@gmail.com" }))), false);
    assert.equal(gate.admits(new GoogleAccount(profile({ verified: false }))), false);
    assert.equal(gate.admits(new GoogleAccount(profile({ email: "" }))), false);
    assert.equal(new SignInGate({ emails: [undefined] }).admits(new GoogleAccount(profile({ email: "" }))), false);
  });

// --- SignIn ---

test("sign-in never asks the database about someone the gate turned away", async () =>
  {
    let asked = 0;
    const userFor = async () =>
      {
        asked += 1;
        return { id: "u" };
      };
    const signIn = new SignIn({ gate: { admits: () => false }, logins: { userFor } });
    assert.deepEqual(await signIn.attempt(new GoogleAccount(profile())), { reason: "not_allowed" });
    assert.equal(asked, 0);
  });

test("sign-in hands back the user, or not_linkable when the login book has none", async () =>
  {
    const gate = { admits: () => true };
    assert.deepEqual(await new SignIn({ gate, logins: { userFor: async () => ({ id: "u" }) } }).attempt(new GoogleAccount(profile())), { user: { id: "u" } });
    assert.deepEqual(await new SignIn({ gate, logins: { userFor: async () => null } }).attempt(new GoogleAccount(profile())), { reason: "not_linkable" });
  });

// --- AuthSettings ---

test("the server won't start without a 32+ character SESSION_SECRET, and the message never shows it", () =>
  {
    assert.throws(() => new AuthSettings({ env: {} }).check(), /SESSION_SECRET is missing/);
    const short = "short-secret-123";
    assert.throws(() => new AuthSettings({ env: { SESSION_SECRET: short } }).check(), (error) => /too short/.test(error.message) && !error.message.includes(short));
    assert.doesNotThrow(() => new AuthSettings({ env: { SESSION_SECRET: SECRET } }).check());
  });

test("on Cloud Run the server won't start without CLIENT_URL", () =>
  {
    assert.throws(() => new AuthSettings({ env: { SESSION_SECRET: SECRET, K_SERVICE: "sleekboard-server" } }).check(), /CLIENT_URL/);
    assert.doesNotThrow(() => new AuthSettings({ env: { SESSION_SECRET: SECRET, K_SERVICE: "sleekboard-server", CLIENT_URL: "https://sleekboard.app" } }).check());
  });

test("the callback defaults to this Mac's port, and secure cookies follow an https callback", () =>
  {
    const local = new AuthSettings({ env: { PORT: "5050" } });
    assert.equal(local.callbackUrl(), "http://localhost:5050/api/auth/google/callback");
    assert.equal(local.isSecure(), false);
    const live = new AuthSettings({ env: { GOOGLE_SIGNIN_REDIRECT_URI: "https://sleekboard.app/api/auth/google/callback" } });
    assert.equal(live.isSecure(), true);
  });

test("after sign-in you land on CLIENT_URL's first origin; failures go to /login with a reason", () =>
  {
    const settings = new AuthSettings({ env: { CLIENT_URL: "http://localhost:5173/, http://other:1" } });
    assert.equal(settings.successUrl(), "http://localhost:5173/");
    assert.equal(settings.failureUrl("not_allowed"), "http://localhost:5173/login?signin=error&reason=not_allowed");
    assert.equal(new AuthSettings({ env: {} }).successUrl(), "http://localhost:5173/");
  });

test("Google counts as set up only with both the client id and secret", () =>
  {
    assert.equal(new AuthSettings({ env: { GMAIL_CLIENT_ID: "id" } }).isConfigured(), false);
    assert.equal(new AuthSettings({ env: { GMAIL_CLIENT_ID: "id", GMAIL_CLIENT_SECRET: "s" } }).isConfigured(), true);
  });
