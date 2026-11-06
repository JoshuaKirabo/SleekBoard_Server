import { test } from "node:test";
import assert from "node:assert/strict";
import argon2 from "argon2";
import { PasswordHash } from "../../src/services/auth/PasswordHash.js";
import { PasswordLogin } from "../../src/services/auth/PasswordLogin.js";
import { PasswordSignIn } from "../../src/services/auth/PasswordSignIn.js";
import { SignInGate } from "../../src/services/auth/SignInGate.js";

const hasher = new PasswordHash();

// --- PasswordHash ---

test("a hash is argon2id with node-argon2's defaults, its own salt, and never the password itself", async () =>
  {
    const first = await hasher.make("correct horse");
    const second = await hasher.make("correct horse");
    assert.match(first, /^\$argon2id\$v=19\$m=65536,t=3,p=4\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
    assert.notEqual(first, second, "two hashes of one password should differ by their salt");
    assert.equal(first.includes("correct horse"), false);
  });

test("the right password matches; a wrong one, a different case or a trailing space doesn't", async () =>
  {
    const stored = await hasher.make("correct horse");
    assert.equal(await hasher.matches("correct horse", stored), true);
    assert.equal(await hasher.matches("correct horsf", stored), false);
    assert.equal(await hasher.matches("Correct horse", stored), false);
    assert.equal(await hasher.matches("correct horse ", stored), false);
    assert.equal(await hasher.matches("", stored), false);
  });

test("anything that isn't an argon2 hash never matches, plain text included", async () =>
  {
    assert.equal(await hasher.matches("secret", "secret"), false);
    assert.equal(await hasher.matches("secret", null), false);
    assert.equal(await hasher.matches("secret", ""), false);
    assert.equal(await hasher.matches("secret", "scrypt:32768:8:1$salt$abcd"), false);
  });

test("a hash made with other settings still checks, using the settings it carries", async () =>
  {
    const stored = await argon2.hash("pw", { memoryCost: 19456, timeCost: 2, parallelism: 1 });
    assert.match(stored, /m=19456,t=2,p=1/);
    assert.equal(await hasher.matches("pw", stored), true);
    assert.equal(await hasher.matches("pw2", stored), false);
  });

// --- PasswordLogin ---

test("a login reads a lowercase trimmed email, the password as typed, and remember only when it's a real true", () =>
  {
    const login = new PasswordLogin({ email: "  Josh@Gmail.COM ", password: " pass word ", remember: true });
    assert.equal(login.email(), "josh@gmail.com");
    assert.equal(login.password(), " pass word ");
    assert.equal(login.remember(), true);
    assert.equal(new PasswordLogin({ remember: "true" }).remember(), false);
    assert.equal(new PasswordLogin({}).remember(), false);
  });

test("a login with missing or wrong-typed fields reads as empty", () =>
  {
    const odd = new PasswordLogin({ email: ["josh@gmail.com"], password: { $ne: "" } });
    assert.equal(odd.email(), "");
    assert.equal(odd.password(), "");
    assert.equal(new PasswordLogin(undefined).email(), "");
  });

// --- SignInGate.allows ---

test("the gate allows the owner's email and nothing else, and nobody when OWNER_EMAIL is empty", () =>
  {
    const gate = new SignInGate({ emails: [" JOSH@gmail.com "] });
    assert.equal(gate.allows("josh@gmail.com"), true);
    assert.equal(gate.allows("sam@gmail.com"), false);
    assert.equal(gate.allows(""), false);
    assert.equal(new SignInGate({ emails: [undefined] }).allows(""), false);
  });

// --- PasswordSignIn ---

const OWNER = { id: "u1", email: "josh@gmail.com", name: "Josh" };

// A sign-in over one stored account, counting how often it looked anyone up.
const signInWith = async ({ password = "right", hasPassword = true, owners = ["josh@gmail.com"] } = {}) =>
  {
    const passwordHash = hasPassword ? await hasher.make(password) : null;
    const asked = [];
    const holder = async (email) =>
      {
        asked.push(email);
        return email === OWNER.email ? { ...OWNER, passwordHash } : null;
      };
    const signIn = new PasswordSignIn({ gate: new SignInGate({ emails: owners }), passwords: { holder }, hasher });
    return { signIn, asked };
  };

const typed = (email, password) => new PasswordLogin({ email, password });

test("the right password signs the owner in as their public fields, never with the hash", async () =>
  {
    const { signIn } = await signInWith();
    assert.deepEqual(await signIn.attempt(typed(" JOSH@gmail.com", "right")), { user: OWNER });
  });

test("a wrong password, an unknown email and an account with no password all get the same answer", async () =>
  {
    const { signIn } = await signInWith();
    assert.deepEqual(await signIn.attempt(typed("josh@gmail.com", "wrong")), { reason: "wrong" });
    const unknown = await signInWith({ owners: ["josh@gmail.com", "nobody@gmail.com"] });
    assert.deepEqual(await unknown.signIn.attempt(typed("nobody@gmail.com", "right")), { reason: "wrong" });
    const googleOnly = await signInWith({ hasPassword: false });
    assert.deepEqual(await googleOnly.signIn.attempt(typed("josh@gmail.com", "")), { reason: "wrong" });
    assert.deepEqual(await googleOnly.signIn.attempt(typed("josh@gmail.com", "right")), { reason: "wrong" });
  });

test("someone who isn't the owner is turned away the same way, before anyone is looked up", async () =>
  {
    const { signIn, asked } = await signInWith({ owners: ["someone-else@gmail.com"] });
    assert.deepEqual(await signIn.attempt(typed("josh@gmail.com", "right")), { reason: "wrong" });
    assert.deepEqual(asked, []);
  });

test("an empty email or password is turned away without a lookup", async () =>
  {
    const { signIn, asked } = await signInWith();
    assert.deepEqual(await signIn.attempt(typed("", "right")), { reason: "wrong" });
    assert.deepEqual(await signIn.attempt(typed("josh@gmail.com", "")), { reason: "wrong" });
    assert.deepEqual(asked, []);
  });
