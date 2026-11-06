import { test } from "node:test";
import assert from "node:assert/strict";
import { CurrentUser } from "../../src/services/users/CurrentUser.js";
import { requireUser } from "../../src/middleware/requireUser.js";
import { Runner } from "../../src/agent/Runner.js";
import { SpendingCap } from "../../src/agent/SpendingCap.js";
import { MailTimer } from "../../src/services/email/MailTimer.js";
import { MemoryLog, MemoryRunStore } from "../fakes.js";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- CurrentUser ---

test("nobody is current outside a request, and a store asking then gets a 401", () =>
  {
    const people = new CurrentUser();
    assert.equal(people.current(), null);
    assert.throws(() => people.id(), (error) => error.status === 401 && /Not signed in/.test(error.message));
  });

test("work stays its user's across awaits and timers, and two users side by side don't mix", async () =>
  {
    const people = new CurrentUser();
    const seen = [];
    const work = (name) => async () =>
      {
        await pause(5);
        seen.push([name, people.id()]);
        await new Promise((resolve) => setTimeout(() => resolve(seen.push([`${name} timer`, people.id()])), 5));
      };
    await Promise.all([people.as("ann", work("ann")), people.as("ben", work("ben"))]);
    for(const [name, id] of seen) assert.equal(id, name.split(" ")[0]);
    assert.equal(seen.length, 4);
    assert.equal(people.current(), null);
  });

// --- requireUser ---

test("the lock answers 401 without a signed-in user and never reaches the route", () =>
  {
    const people = new CurrentUser();
    const res = { code: 0, status: (code) => Object.assign(res, { code }), json: (body) => Object.assign(res, { body }) };
    let reached = false;
    const next = () =>
      {
        reached = true;
      };
    requireUser(people)({}, res, next);
    assert.equal(res.code, 401);
    assert.equal(reached, false);
  });

test("a signed-in request goes through as its user", async () =>
  {
    const people = new CurrentUser();
    let inside = null;
    const next = async () =>
      {
        await pause(1);
        inside = people.id();
      };
    await requireUser(people)({ user: { id: "ann" } }, {}, next);
    assert.equal(inside, "ann");
  });

// --- Runner ---

test("a queued run works as whoever started it, even when someone else's run finishing launches it", async () =>
  {
    const people = new CurrentUser();
    const store = new MemoryRunStore();
    const ranAs = new Map();
    const task = { start: async (run) => ({ brief: () => ({ system: "s", task: run.job }), tools: () => [], result: (answer) => answer }) };
    const buildAgent = () => (
      {
        run: async ({ task: job }) =>
          {
            await pause(10);
            ranAs.set(job, people.id());
            return "ok";
          },
      });
    const cap = new SpendingCap({ store, maxRuns: 20, maxUsd: 1 });
    const runner = new Runner({ store, cap, tasks: new Map([["contact", task]]), buildAgent, logFor: () => new MemoryLog(), people, slots: 1 });
    await people.as("ann", () => runner.submit("contact", "ann-job"));
    await people.as("ben", () => runner.submit("contact", "ben-job"));
    await runner.idle();
    assert.equal(ranAs.get("ann-job"), "ann");
    assert.equal(ranAs.get("ben-job"), "ben");
  });

// --- MailTimer ---

test("each round checks every mailbox as its owner, and one owner's check still going doesn't hold up another's", async () =>
  {
    const people = new CurrentUser();
    const submitted = [];
    const runner = { submit: async (kind) => (submitted.push(people.id()), { id: `run-${people.id()}-${submitted.length}` }) };
    const asked = [];
    const tokens = { connected: async () => (asked.push(people.id()), people.id() !== "cal"), access: async () => `token-${people.id()}` };
    const check = { hasNew: async (token) => token === `token-${people.id()}` };
    // Ann's first check is still running at the next round; Ben's has finished.
    const store = { find: async (id) => ({ id, status: id.startsWith("run-ann") ? "running" : "done" }) };
    const timer = new MailTimer({ runner, store, tokens, check, everyMs: 60_000, people, mailboxes: { owners: async () => ["ann", "ben", "cal"] } });
    await timer.round();
    assert.deepEqual(asked, ["ann", "ben", "cal"]);
    assert.deepEqual(submitted, ["ann", "ben"]);
    await timer.round();
    assert.deepEqual(submitted, ["ann", "ben", "ben"]);
  });

test("a round whose mailbox list can't be read is logged and doesn't throw", async () =>
  {
    const owners = async () =>
      {
        throw new Error("db down");
      };
    const timer = new MailTimer({ runner: {}, store: {}, tokens: {}, check: {}, everyMs: 60_000, people: new CurrentUser(), mailboxes: { owners } });
    const warn = console.warn;
    const said = [];
    console.warn = (...parts) => said.push(parts.join(" "));
    try
      {
        await timer.round();
      }
    finally
      {
        console.warn = warn;
      }
    assert.match(said[0], /couldn't list mailboxes: db down/);
  });
