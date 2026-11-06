import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.ts";
import { PasswordHash } from "../../src/services/auth/PasswordHash.js";
import { PasswordAccounts } from "../../src/services/auth/PasswordAccounts.js";
import { UserSessions } from "../../src/services/auth/UserSessions.js";
import { PasswordReset, Refusal } from "../../src/services/auth/PasswordReset.js";

// set-password's database side against the test database, as sleekboard_app like the script: the account it finds,
// the hash it saves, and the session rows it deletes. Session rows are written in the shape connect-pg-simple and
// passport leave them (sess.passport.user = the user's id). Skipped unless TEST_DATABASE_URL is set; `npm run test:db`
// runs it.
const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : "TEST_DATABASE_URL isn't set";

let db;
let reset;
const hasher = new PasswordHash();
const email = `reset-${randomUUID()}@example.com`;
const otherEmail = `other-${randomUUID()}@example.com`;
let user;
let other;
const sids = [];

// A session row like connect-pg-simple writes, signed in as userId, or nobody when it's null.
const addSession = async (userId) =>
  {
    const sid = randomUUID();
    sids.push(sid);
    const sess = { cookie: { originalMaxAge: null, expires: null, httpOnly: true, path: "/" }, ...(userId && { passport: { user: userId } }) };
    await db.session.create({ data: { sid, sess, expire: new Date(Date.now() + 60_000) } });
    return sid;
  };

const sessionsLeft = async () => (await db.session.findMany({ where: { sid: { in: sids } }, select: { sid: true } })).map((row) => row.sid).sort();

const answer = (password, signOut) => async () => ({ password, signOut });

before(async () =>
  {
    if(skip) return;
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    reset = new PasswordReset({ accounts: new PasswordAccounts({ db }), hasher, sessions: new UserSessions({ db }) });
    user = await db.user.create({ data: { email, name: "Reset", logins: { create: { provider: "https://accounts.google.com", subject: `g-${randomUUID()}` } } } });
    other = await db.user.create({ data: { email: otherEmail, name: "Other" } });
  });

after(async () =>
  {
    if(skip) return;
    await db.session.deleteMany({ where: { sid: { in: sids } } });
    await db.user.deleteMany({ where: { id: { in: [user.id, other.id] } } });
    await db.$disconnect();
  });

test("the account is found by email and shown without its hash", { skip }, async () =>
  {
    const found = await new PasswordAccounts({ db }).find(email);
    const login = await db.federatedCredential.findFirst({ where: { userId: user.id } });
    assert.deepEqual(found, { id: user.id, email, name: "Reset", hasPassword: false, googleIds: [login.subject] });
  });

test("an unknown email is refused and no user is made", { skip }, async () =>
  {
    const missing = `missing-${randomUUID()}@example.com`;
    await assert.rejects(reset.run(missing, answer("pw", true)), Refusal);
    assert.equal(await db.user.findUnique({ where: { email: missing } }), null);
  });

test("the new password is saved as an argon2id hash that checks, and saying no to signing out keeps every session", { skip }, async () =>
  {
    const mine = await addSession(user.id);
    const result = await reset.run(email, answer("first password", false));
    assert.equal(result.ended, 0);
    const saved = await db.user.findUnique({ where: { id: user.id } });
    assert.match(saved.passwordHash, /^\$argon2id\$/);
    assert.equal(await hasher.matches("first password", saved.passwordHash), true);
    assert.equal((await new PasswordAccounts({ db }).find(email)).hasPassword, true);
    assert.deepEqual(await sessionsLeft(), [mine].sort());
  });

test("signing out everywhere deletes only that user's session rows", { skip }, async () =>
  {
    await addSession(user.id);
    await addSession(user.id);
    const others = await addSession(other.id);
    const nobody = await addSession(null);
    const result = await reset.run(email, answer("second password", true));
    // The two just made plus the one the last test kept.
    assert.equal(result.ended, 3);
    assert.deepEqual(await sessionsLeft(), [others, nobody].sort());
    const saved = await db.user.findUnique({ where: { id: user.id } });
    assert.equal(await hasher.matches("second password", saved.passwordHash), true);
    assert.equal(await hasher.matches("first password", saved.passwordHash), false);
    assert.equal((await db.user.findUnique({ where: { id: other.id } })).passwordHash, null);
  });
