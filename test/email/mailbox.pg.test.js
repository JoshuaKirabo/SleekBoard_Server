import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.ts";
import { MailboxStore } from "../../src/services/email/MailboxStore.js";

// The real MailboxStore against the test database (see test/jobs/store.pg.test.js). Skipped unless TEST_DATABASE_URL
// is set; `npm run test:db` runs these.
const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : "TEST_DATABASE_URL isn't set";

let db;
const people = [];

const person = async () =>
  {
    const user = await db.user.create({ data: { email: `test-${randomUUID()}@example.com` } });
    people.push(user.id);
    return new MailboxStore({ db, userId: async () => user.id });
  };

before(async () =>
  {
    if(skip) return;
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });

after(async () =>
  {
    if(skip) return;
    await db.user.deleteMany({ where: { id: { in: people } } });
    await db.$disconnect();
  });

test("the mailbox is made the first time it's asked for, once", { skip }, async () =>
  {
    const mailbox = await person();
    const box = await mailbox.get();
    assert.deepEqual(box.processed, []);
    assert.deepEqual(box.resting, []);
    assert.equal(box.caughtUp, false);
    assert.equal(box.login, "");
    assert.equal("userId" in box, false);
    assert.equal((await mailbox.get()).id, box.id);
  });

test("handled ids keep their order, the newest 500, and leave the resting list", { skip }, async () =>
  {
    const mailbox = await person();
    await mailbox.leave("m-3");
    for(let i = 0; i < 503; i++) await mailbox.remember(`m-${i}`);
    const box = await mailbox.get();
    assert.equal(box.processed.length, 500);
    assert.equal(box.processed[0], "m-3");
    assert.equal(box.processed.at(-1), "m-502");
    assert.deepEqual(box.resting, []);
  });

test("a resting message is kept once, with its newest time", { skip }, async () =>
  {
    const mailbox = await person();
    await mailbox.leave("m-1");
    const first = (await mailbox.get()).resting[0].at;
    await new Promise((resolve) => setTimeout(resolve, 20));
    await mailbox.leave("m-1");
    await mailbox.leave("m-2");
    const box = await mailbox.get();
    assert.deepEqual(box.resting.map((one) => one.id), ["m-1", "m-2"]);
    assert.ok(box.resting[0].at > first);
  });

test("connecting the same inbox keeps what's handled; a different one starts over", { skip }, async () =>
  {
    const mailbox = await person();
    await mailbox.connect("locked-1", "josh@gmail.com");
    await mailbox.remember("m-1");
    await mailbox.leave("m-2");
    await mailbox.checked(true);
    await mailbox.markExpired("print-1");

    await mailbox.connect("locked-2", "josh@gmail.com");
    let box = await mailbox.get();
    assert.deepEqual(box.processed, ["m-1"]);
    assert.equal(box.caughtUp, true);
    assert.equal(box.expired, "");
    assert.equal(box.login, "locked-2");

    await mailbox.connect("locked-3", "other@gmail.com");
    box = await mailbox.get();
    assert.deepEqual(box.processed, []);
    assert.deepEqual(box.resting, []);
    assert.equal(box.caughtUp, false);
    assert.equal(box.address, "other@gmail.com");
  });

test("disconnecting forgets the login but keeps what's handled", { skip }, async () =>
  {
    const mailbox = await person();
    await mailbox.connect("locked-1", "josh@gmail.com");
    await mailbox.remember("m-1");
    await mailbox.disconnect();
    const box = await mailbox.get();
    assert.equal(box.login, "");
    assert.equal(box.address, "");
    assert.equal(box.connectedAt, null);
    assert.deepEqual(box.processed, ["m-1"]);
  });

test("a check only marks caught up when it read everything", { skip }, async () =>
  {
    const mailbox = await person();
    await mailbox.checked(false);
    let box = await mailbox.get();
    assert.equal(box.caughtUp, false);
    assert.ok(box.checkedAt instanceof Date);
    await mailbox.checked(true);
    await mailbox.checked(false);
    box = await mailbox.get();
    assert.equal(box.caughtUp, true);
  });

test("two people's mailboxes never mix", { skip }, async () =>
  {
    const josh = await person();
    const other = await person();
    await josh.connect("josh-login", "josh@gmail.com");
    await josh.remember("m-1");
    const theirs = await other.get();
    assert.equal(theirs.login, "");
    assert.deepEqual(theirs.processed, []);
    assert.notEqual(theirs.id, (await josh.get()).id);
  });

test("20 messages handled at the same moment are all kept", { skip }, async () =>
  {
    const mailbox = await person();
    await mailbox.get();
    await Promise.all(Array.from({ length: 20 }, (_, i) => mailbox.remember(`m-${i}`)));
    const box = await mailbox.get();
    assert.equal(box.processed.length, 20);
    assert.equal(new Set(box.processed).size, 20);
  });
