import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.ts";
import { ContactBook } from "../../src/services/contacts/ContactBook.js";
import { ConnectionBook } from "../../src/services/contacts/ConnectionBook.js";
import { JobStore } from "../../src/services/jobs/JobStore.js";

// The real ContactBook and ConnectionBook against the test database (see test/jobs/store.pg.test.js). Skipped unless
// TEST_DATABASE_URL is set; `npm run test:db` runs these. Every test makes its own people and deletes them after.
const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : "TEST_DATABASE_URL isn't set";

let db;
const people = [];

const person = async () =>
  {
    const user = await db.user.create({ data: { email: `test-${randomUUID()}@example.com` } });
    people.push(user.id);
    const userId = async () => user.id;
    return { user, jobs: new JobStore({ db, userId }), book: new ContactBook({ db, userId }), connections: new ConnectionBook({ db, userId }) };
  };

const statusOf = async (work) =>
  {
    try
      {
        await work;
        return 200;
      }
    catch(error)
      {
        return error.status || error.code;
      }
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

test("saving a contact gives the board's shape, linked to the job, with a Mongo-style id", { skip }, async () =>
  {
    const { jobs, book } = await person();
    const job = await jobs.create({ company: "Stripe", role: "SWE" });
    const sam = await book.save({ name: " Sam Rivera ", company: "Stripe", type: "recruiter", title: "Recruiter", source: "run" }, job.id);
    assert.match(sam.id, /^[0-9a-f]{24}$/);
    assert.equal(sam.name, "Sam Rivera");
    assert.deepEqual(sam.jobs, [job.id]);
    assert.equal(sam.source, "run");
    for(const hidden of ["userId", "key", "companyKey", "companyWords"]) assert.equal(hidden in sam, false);
  });

test("saving the same person again updates them in place; blanks don't wipe, the source stays", { skip }, async () =>
  {
    const { jobs, book } = await person();
    const first = await jobs.create({ company: "Stripe", role: "SWE" });
    const second = await jobs.create({ company: "Stripe", role: "PM" });
    const saved = await book.save({ name: "Sam Rivera", company: "Stripe", title: "Recruiter", email: "sam@stripe.com", source: "run" }, first.id);
    const again = await book.save({ name: "SAM RIVERA", company: "stripe", title: "Lead Recruiter", email: "", source: "linkedin" }, second.id);
    assert.equal(again.id, saved.id);
    assert.equal(again.title, "Lead Recruiter");
    assert.equal(again.email, "sam@stripe.com");
    assert.equal(again.source, "run");
    assert.deepEqual([...again.jobs].sort(), [first.id, second.id].sort());
  });

test("a contact without a name, of an unknown kind, or too long is refused with a 400", { skip }, async () =>
  {
    const { jobs, book } = await person();
    const job = await jobs.create({ company: "Stripe", role: "SWE" });
    assert.equal(await statusOf(book.save({ name: "", company: "Stripe" }, job.id)), 400);
    assert.equal(await statusOf(book.save({ name: "Sam", company: "Stripe", type: "boss" }, job.id)), 400);
    assert.equal(await statusOf(book.save({ name: "Sam", company: "Stripe", title: "x".repeat(201) }, job.id)), 400);
    assert.deepEqual(await book.forJob(job.id), []);
  });

test("warm leads: someone saved for one job turns up for another at the same company, however it's spelled", { skip }, async () =>
  {
    const { jobs, book } = await person();
    const old = await jobs.create({ company: "Stripe", role: "SWE" });
    const fresh = await jobs.create({ company: "Stripe, Inc.", role: "PM" });
    await book.save({ name: "Ana Lopez", company: "Stripe" }, old.id);
    await book.save({ name: "Ben Ng", company: "Figma" }, old.id);

    const leads = await book.atCompany("Stripe, Inc.", fresh.id);
    assert.deepEqual(leads.map((lead) => [lead.name, lead.match]), [["Ana Lopez", "strong"]]);
    assert.deepEqual(await book.atCompany("Stripe", old.id), []);
  });

test("one person's contacts never show up for, or can be changed by, another", { skip }, async () =>
  {
    const josh = await person();
    const other = await person();
    const job = await josh.jobs.create({ company: "Stripe", role: "SWE" });
    const theirJob = await other.jobs.create({ company: "Stripe", role: "SWE" });
    const sam = await josh.book.save({ name: "Sam Rivera", company: "Stripe" }, job.id);

    assert.equal(await other.book.find(sam.id), null);
    assert.deepEqual(await other.book.atCompany("Stripe", theirJob.id), []);
    assert.equal(await other.book.link(sam.id, theirJob.id), null);
    assert.equal(await other.book.unlink(sam.id, job.id), null);
    assert.equal(await statusOf(josh.book.link(sam.id, theirJob.id)), "P2003");
    assert.deepEqual((await josh.book.find(sam.id)).jobs, [job.id]);
  });

test("link and unlink move a contact between jobs, and deleting a job keeps the person", { skip }, async () =>
  {
    const { jobs, book } = await person();
    const first = await jobs.create({ company: "Stripe", role: "SWE" });
    const second = await jobs.create({ company: "Stripe", role: "PM" });
    const sam = await book.save({ name: "Sam Rivera", company: "Stripe" }, first.id);

    assert.deepEqual([...(await book.link(sam.id, second.id)).jobs].sort(), [first.id, second.id].sort());
    assert.deepEqual((await book.link(sam.id, second.id)).jobs.length, 2);
    assert.deepEqual((await book.unlink(sam.id, first.id)).jobs, [second.id]);
    assert.equal(await book.link("ffffffffffffffffffffffff", first.id), null);

    await jobs.remove(second.id);
    const kept = await book.find(sam.id);
    assert.deepEqual(kept.jobs, []);
    assert.equal(kept.name, "Sam Rivera");
  });

test("an upload replaces only your connections, skips rows it can't keep, and goes in batches", { skip }, async () =>
  {
    const josh = await person();
    const other = await person();
    await other.connections.replace([{ name: "Their Friend", company: "Stripe" }]);
    await josh.connections.replace([{ name: "Old Friend", company: "Figma" }]);

    const many = Array.from({ length: 5000 }, (_, i) => ({ name: `Person ${i}`, company: i % 2 ? "Stripe" : "Figma", connectedOn: "2025-01-01" }));
    const summary = await josh.connections.replace([...many, { name: "No Company", company: "" }, { name: "x".repeat(201), company: "Stripe" }]);
    assert.equal(summary.count, 5000);
    assert.ok(summary.importedAt instanceof Date);
    assert.equal((await other.connections.summary()).count, 1);
    assert.equal((await josh.connections.matchesFor("Figma")).some((connection) => connection.name === "Old Friend"), false);
  });

test("a failed upload leaves the old list as it was", { skip }, async () =>
  {
    const { connections } = await person();
    await connections.replace([{ name: "Keep Me", company: "Stripe" }]);
    assert.equal(await statusOf(connections.replace(Array.from({ length: 30001 }, () => ({ name: "a", company: "b" })))), 413);
    assert.equal((await connections.summary()).count, 1);
  });

test("connection matches: exact before strong, newest first, weak left out, never someone else's", { skip }, async () =>
  {
    const josh = await person();
    const other = await person();
    await other.connections.replace([{ name: "Their Friend", company: "Stripe" }]);
    await josh.connections.replace(
      [
        { name: "Old Exact", company: "Stripe", connectedOn: "2020-01-01" },
        { name: "New Exact", company: "STRIPE", connectedOn: "2024-01-01" },
        { name: "Strong One", company: "Stripe, Inc.", connectedOn: "2025-06-01" },
        { name: "Weak One", company: "Stripe Payments Inc.", connectedOn: "2025-06-01" },
        { name: "Elsewhere", company: "Figma", connectedOn: "2025-06-01" },
      ]);
    const matches = await josh.connections.matchesFor("Stripe");
    assert.deepEqual(matches.map((connection) => [connection.name, connection.match]), [["New Exact", "exact"], ["Old Exact", "exact"], ["Strong One", "strong"]]);
    for(const hidden of ["userId", "tokensAll", "tokensDistinctive", "tokensKey"]) assert.equal(hidden in matches[0], false);
    assert.equal(await other.connections.find(matches[0].id), null);
    await other.connections.clear();
    assert.equal((await josh.connections.summary()).count, 5);
  });
