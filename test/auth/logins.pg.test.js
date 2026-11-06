import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.ts";
import { LoginBook } from "../../src/services/auth/LoginBook.js";
import { GoogleAccount } from "../../src/services/auth/GoogleAccount.js";

// The real LoginBook against the test database (see test/jobs/store.pg.test.js). Skipped unless TEST_DATABASE_URL is
// set; `npm run test:db` runs these. Every test makes its own people and deletes them after.
const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : "TEST_DATABASE_URL isn't set";

let db;
const emails = [];

const email = () =>
  {
    const made = `test-${randomUUID()}@example.com`;
    emails.push(made);
    return made;
  };

const google = (address, id = randomUUID()) => new GoogleAccount({ id, displayName: "Test", emails: [{ value: address, verified: true }] });

before(async () =>
  {
    if(skip) return;
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });

after(async () =>
  {
    if(skip) return;
    await db.user.deleteMany({ where: { email: { in: emails } } });
    await db.$disconnect();
  });

test("a new Google login makes a user with its email and name, linked to that login", { skip }, async () =>
  {
    const address = email();
    const account = google(address);
    const user = await new LoginBook({ db }).userFor(account);
    assert.equal(user.email, address);
    assert.equal(user.name, "Test");
    assert.deepEqual(Object.keys(user).sort(), ["email", "id", "name"]);
    const logins = await db.federatedCredential.findMany({ where: { userId: user.id } });
    assert.equal(logins.length, 1);
    assert.equal(logins[0].provider, "https://accounts.google.com");
    assert.equal(logins[0].subject, account.subject());
  });

test("the same Google login comes back as the same user, even after its email changed", { skip }, async () =>
  {
    const book = new LoginBook({ db });
    const id = randomUUID();
    const first = await book.userFor(google(email(), id));
    const again = await book.userFor(google(email(), id));
    assert.equal(again.id, first.id);
    assert.equal(await db.user.count({ where: { email: { in: emails.slice(-2) } } }), 1);
  });

test("the owner's first sign-in links to the account db:copy made, keeping its data", { skip }, async () =>
  {
    const address = email();
    const owner = await db.user.create({ data: { email: address, name: "Owner" } });
    await db.job.create({ data: { userId: owner.id, company: "Stripe", role: "SWE" } });
    const user = await new LoginBook({ db, linkableEmail: address.toUpperCase() }).userFor(google(address));
    assert.equal(user.id, owner.id);
    assert.equal(await db.job.count({ where: { userId: owner.id } }), 1);
    assert.equal(await db.federatedCredential.count({ where: { userId: owner.id } }), 1);
  });

test("a second Google account with the owner's email is refused once the owner has a login", { skip }, async () =>
  {
    const address = email();
    const book = new LoginBook({ db, linkableEmail: address });
    const owner = await book.userFor(google(address));
    assert.equal(await book.userFor(google(address)), null);
    assert.equal(await db.federatedCredential.count({ where: { userId: owner.id } }), 1);
  });

test("an existing account that isn't the owner's is never linked by email", { skip }, async () =>
  {
    const address = email();
    const someone = await db.user.create({ data: { email: address } });
    assert.equal(await new LoginBook({ db, linkableEmail: "owner@example.com" }).userFor(google(address)), null);
    assert.equal(await new LoginBook({ db }).userFor(google(address)), null);
    assert.equal(await db.federatedCredential.count({ where: { userId: someone.id } }), 0);
  });

test("find gives the user's public fields, and null for a deleted user or a bad id", { skip }, async () =>
  {
    const book = new LoginBook({ db });
    const user = await book.userFor(google(email()));
    assert.deepEqual(await book.find(user.id), user);
    await db.user.delete({ where: { id: user.id } });
    assert.equal(await book.find(user.id), null);
    assert.equal(await book.find(""), null);
    assert.equal(await book.find({ id: user.id }), null);
  });
