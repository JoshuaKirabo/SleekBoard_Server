import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.ts";
import { RunStore } from "../../src/agent/RunStore.js";
import { JobStore } from "../../src/services/jobs/JobStore.js";
import { ContactBook } from "../../src/services/contacts/ContactBook.js";

// The real RunStore against the test database (see test/jobs/store.pg.test.js). Skipped unless TEST_DATABASE_URL is
// set; `npm run test:db` runs these, one file at a time, since the spending cap's totals count every run.
const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : "TEST_DATABASE_URL isn't set";

let db;
const people = [];

const person = async () =>
  {
    const user = await db.user.create({ data: { email: `test-${randomUUID()}@example.com` } });
    people.push(user.id);
    const userId = async () => user.id;
    return { user, runs: new RunStore({ db, userId }), jobs: new JobStore({ db, userId }), book: new ContactBook({ db, userId }) };
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

test("a new run comes back in the board's shape", { skip }, async () =>
  {
    const { runs, jobs, book } = await person();
    const job = await jobs.create({ company: "Stripe", role: "SWE" });
    const sam = await book.save({ name: "Sam", company: "Stripe" }, job.id);
    const run = await runs.create({ kind: "note", job: job.id, budget: 0.05, input: { contact: sam.id } });
    assert.equal(run.status, "queued");
    assert.equal(run.job, job.id);
    assert.deepEqual(run.input, { contact: sam.id });
    assert.deepEqual(run.steps, []);
    assert.equal(run.budget, 0.05);
    assert.equal("userId" in run, false);

    const fill = await runs.create({ kind: "fill", budget: 0.1, input: { link: "https://jobs.example.com/1" } });
    assert.equal(fill.job, null);
    assert.deepEqual(fill.input, { link: "https://jobs.example.com/1" });
  });

test("a contact or note run without a job is refused, like the Mongo model did", { skip }, async () =>
  {
    const { runs } = await person();
    assert.equal(await statusOf(runs.create({ kind: "contact", budget: 0.1 })), 400);
    assert.equal(await statusOf(runs.create({ kind: "email", budget: 0.01 })), 200);
  });

test("a run's life: steps only while running, nothing after the end except a late bill", { skip }, async () =>
  {
    const { runs } = await person();
    const run = await runs.create({ kind: "fill", budget: 0.1 });

    await runs.addStep(run.id, { type: "message", text: "too early" });
    assert.equal((await runs.markRunning(run.id)).count, 1);
    assert.equal((await runs.markRunning(run.id)).count, 0);
    await runs.addStep(run.id, { type: "tool", text: "read_page jobs.example.com" });
    await runs.addStep(run.id, { type: "message", text: "x".repeat(1500) });
    await runs.addUsage(run.id, { model: "m", input: 1000, output: 50, cost: 0.002 });
    assert.equal((await runs.fail(run.id, "Out of time")).count, 1);

    assert.equal((await runs.finish(run.id, { job: {} })).count, 0);
    await runs.addStep(run.id, { type: "message", text: "too late" });
    await runs.addUsage(run.id, { tool: "web_search", cost: 0.007 });

    const after = await runs.find(run.id);
    assert.equal(after.status, "failed");
    assert.equal(after.error, "Out of time");
    assert.deepEqual(after.steps.map((step) => step.text), ["read_page jobs.example.com", "x".repeat(1000)]);
    assert.deepEqual(after.usage.map((entry) => entry.tool || entry.model), ["m", "web_search"]);
    assert.equal(Math.round(after.cost * 1e6), 9000);
  });

test("one person can't read, list or attach another person's runs", { skip }, async () =>
  {
    const josh = await person();
    const other = await person();
    const job = await josh.jobs.create({ company: "Stripe", role: "SWE" });
    const theirJob = await other.jobs.create({ company: "Figma", role: "PM" });
    const run = await josh.runs.create({ kind: "contact", job: job.id, budget: 0.1 });
    const fill = await josh.runs.create({ kind: "fill", budget: 0.1 });

    assert.equal(await other.runs.find(run.id), null);
    assert.deepEqual(await other.runs.forJob(job.id), []);
    assert.equal(await other.runs.attach(fill.id, theirJob.id), false);
    assert.equal(await statusOf(josh.runs.attach(fill.id, theirJob.id)), "P2003");
    assert.equal((await josh.runs.find(fill.id)).job, null);
    assert.equal(await statusOf(other.runs.create({ kind: "contact", job: job.id, budget: 0.1 })), "P2003");
  });

test("a fill run gets its job once, and only a fill run", { skip }, async () =>
  {
    const { runs, jobs } = await person();
    const job = await jobs.create({ company: "Stripe", role: "SWE" });
    const fill = await runs.create({ kind: "fill", budget: 0.1 });
    const contact = await runs.create({ kind: "contact", job: job.id, budget: 0.1 });
    assert.equal(await runs.attach(fill.id, job.id), true);
    assert.equal(await runs.attach(fill.id, job.id), false);
    assert.equal(await runs.attach(contact.id, job.id), false);
    assert.equal((await runs.forJob(job.id)).length, 2);
  });

test("a suggestion is answered once, even with two clicks at the same moment", { skip }, async () =>
  {
    const { runs, jobs } = await person();
    const job = await jobs.create({ company: "Stripe", role: "SWE" });
    const run = await runs.create({ kind: "contact", job: job.id, budget: 0.1 });
    await runs.markRunning(run.id);
    await runs.finish(run.id, { contacts: [{ name: "Sam" }, { name: "Ana" }], note: "" });

    const answers = await Promise.all([runs.decide(run.id, 0, "accept"), runs.decide(run.id, 0, "reject")]);
    assert.equal(answers.filter(Boolean).length, 1);
    assert.equal(await runs.decide(run.id, 1, "reject"), true);
    assert.equal(await runs.decide(run.id, 5, "accept"), false);
    const contacts = (await runs.find(run.id)).result.contacts;
    assert.ok(["accept", "reject"].includes(contacts[0].decision));
    assert.equal(contacts[1].decision, "reject");
  });

test("the cap counts ended runs at cost and live ones at their budget; email checks cost but don't count", { skip }, async () =>
  {
    const { runs } = await person();
    const since = new Date();
    const ended = await runs.create({ kind: "fill", budget: 0.5 });
    await runs.markRunning(ended.id);
    await runs.addUsage(ended.id, { model: "m", cost: 0.03 });
    await runs.finish(ended.id, {});
    const live = await runs.create({ kind: "fill", budget: 0.2 });
    await runs.addUsage(live.id, { model: "m", cost: 0.01 });
    const pricey = await runs.create({ kind: "fill", budget: 0.05 });
    await runs.addUsage(pricey.id, { model: "m", cost: 0.08 });
    const email = await runs.create({ kind: "email", budget: 0.01 });
    await runs.markRunning(email.id);
    await runs.addUsage(email.id, { model: "m", cost: 0.004 });
    await runs.finish(email.id, {});

    assert.equal(Math.round((await runs.costSince(since)) * 1e6), Math.round((0.03 + 0.2 + 0.08 + 0.004) * 1e6));
    assert.equal(await runs.countSince(since), 3);
    assert.equal(await runs.costSince(new Date(Date.now() + 60_000)), 0);
  });

test("after a restart, every queued or running run is failed", { skip }, async () =>
  {
    const { runs } = await person();
    const queued = await runs.create({ kind: "fill", budget: 0.1 });
    const running = await runs.create({ kind: "fill", budget: 0.1 });
    await runs.markRunning(running.id);
    const done = await runs.create({ kind: "fill", budget: 0.1 });
    await runs.markRunning(done.id);
    await runs.finish(done.id, {});

    await runs.failInterrupted();
    assert.equal((await runs.find(queued.id)).status, "failed");
    assert.equal((await runs.find(running.id)).error, "The server restarted before this run finished.");
    assert.equal((await runs.find(done.id)).status, "done");
  });
