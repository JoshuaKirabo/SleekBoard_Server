import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.ts";
import { JobStore } from "../../src/services/jobs/JobStore.js";
import { LaneHistory } from "../../src/services/jobs/LaneHistory.js";

// The real JobStore against a real Postgres: a separate test database, never the one you use. Skipped unless
// TEST_DATABASE_URL is set, so `npm test` still runs with no database. `npm run test:db` runs these.
//
// Every test makes its own people and deletes them after, which takes their jobs with them.
const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : "TEST_DATABASE_URL isn't set";

let db;
const people = [];

const person = async () =>
  {
    const user = await db.user.create({ data: { email: `test-${randomUUID()}@example.com` } });
    people.push(user.id);
    return { user, jobs: new JobStore({ db, userId: async () => user.id }) };
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

test("a new job comes back in the board's shape, with a Mongo-style id and no owner", { skip }, async () =>
  {
    const { jobs } = await person();
    const job = await jobs.create({ company: "Stripe", role: "SWE" });
    assert.match(job.id, /^[0-9a-f]{24}$/);
    assert.equal(job.status, "saved");
    assert.deepEqual(job.moves, []);
    assert.equal(job.replySuggestion, null);
    assert.equal("userId" in job, false);
    assert.ok(job.createdAt instanceof Date);
  });

test("one person can't see, change or delete another person's jobs", { skip }, async () =>
  {
    const josh = await person();
    const other = await person();
    const job = await josh.jobs.create({ company: "Stripe", role: "SWE" });

    assert.deepEqual(await other.jobs.list(), []);
    assert.equal(await other.jobs.find(job.id), null);
    assert.equal(await other.jobs.update(job.id, { notes: "mine now" }), null);
    assert.equal(await other.jobs.moveLane(job.id, "saved", { from: "saved", to: "applied", at: new Date(), source: "board" }), null);
    assert.equal(await other.jobs.noteReply(job.id, { replySnippet: "hi" }), null);
    await other.jobs.fillBlank(job.id, "contact", "Someone");
    assert.equal(await other.jobs.remove(job.id), null);

    const still = await josh.jobs.find(job.id);
    assert.equal(still.status, "saved");
    assert.equal(still.notes, "");
    assert.equal(still.contact, "");
    assert.deepEqual(still.moves, []);
  });

test("a move writes itself down and clears a waiting suggestion", { skip }, async () =>
  {
    const { jobs } = await person();
    const history = new LaneHistory({ jobs });
    const job = await jobs.create({ company: "Figma", role: "PM", status: "applied" });
    await jobs.noteReply(job.id, { replySnippet: "Let's talk" }, { to: "interviewing", confidence: 55, at: new Date() });

    const moved = await history.move(await jobs.find(job.id), "interviewing", "email", { replySnippet: "Interview Tuesday" });
    assert.equal(moved.status, "interviewing");
    assert.equal(moved.replySnippet, "Interview Tuesday");
    assert.equal(moved.replySuggestion, null);
    assert.deepEqual(moved.moves.map(({ from, to, source }) => ({ from, to, source })), [{ from: "applied", to: "interviewing", source: "email" }]);
  });

test("a move from a lane the card has left is refused and writes nothing", { skip }, async () =>
  {
    const { jobs } = await person();
    const history = new LaneHistory({ jobs });
    const job = await jobs.create({ company: "Kpler", role: "Analyst", status: "applied" });
    const read = await jobs.find(job.id);
    await history.move(read, "rejected", "email");

    assert.equal(await history.move(read, "interviewing", "board"), null);
    const now = await jobs.find(job.id);
    assert.equal(now.status, "rejected");
    assert.equal(now.moves.length, 1);
  });

test("two moves at the same moment: exactly one lands", { skip }, async () =>
  {
    const { jobs } = await person();
    const history = new LaneHistory({ jobs });
    const job = await jobs.create({ company: "Datadog", role: "SWE", status: "applied" });
    const read = await jobs.find(job.id);

    const results = await Promise.all([history.move(read, "interviewing", "board"), history.move(read, "rejected", "email")]);
    assert.equal(results.filter(Boolean).length, 1);
    const now = await jobs.find(job.id);
    assert.equal(now.moves.length, 1);
    assert.equal(now.status, now.moves[0].to);
  });

test("undo takes the last move back off, and only the move it saw", { skip }, async () =>
  {
    const { jobs } = await person();
    const history = new LaneHistory({ jobs });
    const job = await jobs.create({ company: "Ramp", role: "SWE", status: "applied" });
    await history.move(await jobs.find(job.id), "interviewing", "board");

    const stale = await jobs.find(job.id);
    await history.move(await jobs.find(job.id), "offer", "board");
    assert.equal(await history.undo(stale, "applied"), null);
    const unchanged = await jobs.find(job.id);
    assert.equal(unchanged.status, "offer");
    assert.equal(unchanged.moves.length, 2);

    const back = await history.undo(await jobs.find(job.id), "interviewing");
    assert.equal(back.status, "interviewing");
    assert.equal(back.moves.length, 1);
  });

test("an undo with the right lane but a different count changes nothing", { skip }, async () =>
  {
    const { jobs } = await person();
    const job = await jobs.create({ company: "Linear", role: "Design Engineer", status: "applied" });
    await jobs.moveLane(job.id, "applied", { from: "applied", to: "interviewing", at: new Date(), source: "board" });

    assert.equal(await jobs.undoLane(job.id, "interviewing", "applied", 5), null);
    const now = await jobs.find(job.id);
    assert.equal(now.status, "interviewing");
    assert.equal(now.moves.length, 1);
  });

test("a blank field fills in, a typed one stays", { skip }, async () =>
  {
    const { jobs } = await person();
    const job = await jobs.create({ company: "Apple", role: "iOS Intern", email: "me@typed.com" });
    await jobs.fillBlank(job.id, "contact", "Sam Rivera");
    await jobs.fillBlank(job.id, "email", "sam@apple.com");
    const now = await jobs.find(job.id);
    assert.equal(now.contact, "Sam Rivera");
    assert.equal(now.email, "me@typed.com");
  });

test("a suggestion can be left and cleared", { skip }, async () =>
  {
    const { jobs } = await person();
    const job = await jobs.create({ company: "Notion", role: "SWE", status: "applied" });
    const suggested = await jobs.noteReply(job.id, { replySnippet: "next steps" }, { to: "interviewing", confidence: 61.5, at: new Date() });
    assert.equal(suggested.replySuggestion.to, "interviewing");
    assert.equal(suggested.replySuggestion.confidence, 61.5);
    const cleared = await jobs.clearSuggestion(job.id);
    assert.equal(cleared.replySuggestion, null);
    assert.equal(cleared.replySnippet, "next steps");
  });

test("deleting a job keeps its runs, with the job emptied, and drops its contact links", { skip }, async () =>
  {
    const { user, jobs } = await person();
    const job = await jobs.create({ company: "Brex", role: "SWE" });
    const run = await db.run.create({ data: { userId: user.id, jobId: job.id, kind: "contact", cost: 0.02 } });
    const contact = await db.contact.create({ data: { userId: user.id, key: `sam|brex|${randomUUID()}`, name: "Sam", company: "Brex", companyKey: "brex" } });
    await db.contactJob.create({ data: { userId: user.id, contactId: contact.id, jobId: job.id } });

    const removed = await jobs.remove(job.id);
    assert.equal(removed.id, job.id);
    assert.equal(await jobs.find(job.id), null);
    const kept = await db.run.findUnique({ where: { id: run.id } });
    assert.equal(kept.jobId, null);
    assert.equal(kept.cost, 0.02);
    assert.equal(await db.contactJob.count({ where: { jobId: job.id } }), 0);
    assert.ok(await db.contact.findUnique({ where: { id: contact.id } }));
  });
