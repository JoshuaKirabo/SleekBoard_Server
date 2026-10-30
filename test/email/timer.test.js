import { test } from "node:test";
import assert from "node:assert/strict";
import { MailTimer } from "../../src/services/email/MailTimer.js";
import { EmailTask } from "../../src/agent/tasks/EmailTask.js";
import { Runner } from "../../src/agent/Runner.js";
import { SpendingCap } from "../../src/agent/SpendingCap.js";
import { MemoryLog, MemoryRunStore } from "../fakes.js";

const connected = { connected: async () => true, access: async () => "tok" };
const offline = { connected: async () => false, access: async () => "" };

// A runner and store that remember what was submitted, with runs that stay in whatever status the test sets.
const timerWith = (tokens, status = "running", news = true) =>
  {
    const submitted = [];
    const runner = { submit: async (kind) => (submitted.push(kind), { id: `run-${submitted.length}` }) };
    const store = { find: async (id) => ({ id, status }) };
    const check = { hasNew: async () => news };
    return { submitted, timer: new MailTimer({ runner, store, tokens, check, everyMs: 60_000 }) };
  };

test("nothing starts while Gmail isn't connected", async () =>
  {
    const { timer, submitted } = timerWith(offline);
    assert.equal(await timer.tick(), null);
    assert.deepEqual(submitted, []);
  });

test("a quiet minute starts no run", async () =>
  {
    const { timer, submitted } = timerWith(connected, "done", false);
    assert.equal(await timer.tick(), null);
    assert.deepEqual(submitted, []);
  });

test("a connected inbox with a reply due gets an email run", async () =>
  {
    const { timer, submitted } = timerWith(connected, "done");
    assert.equal((await timer.tick()).id, "run-1");
    assert.deepEqual(submitted, ["email"]);
  });

test("a new check waits while the last one's still going", async () =>
  {
    const { timer, submitted } = timerWith(connected, "running");
    await timer.tick();
    assert.equal(await timer.tick(), null);
    assert.deepEqual(submitted, ["email"]);
  });

test("once the last check has finished, the next one starts", async () =>
  {
    const { timer, submitted } = timerWith(connected, "done");
    await timer.tick();
    await timer.tick();
    assert.deepEqual(submitted, ["email", "email"]);
  });

test("a check that can't start, like a full day's budget, is logged and doesn't throw", async () =>
  {
    const runner = { submit: async () => { throw new Error("Today's $1 AI budget is used up."); } };
    const timer = new MailTimer({ runner, store: { find: async () => null }, tokens: connected, check: { hasNew: async () => true }, everyMs: 60_000 });
    const warn = console.warn;
    const warned = [];
    console.warn = (...args) => warned.push(args.join(" "));
    try
      {
        assert.equal(await timer.tick(), null);
      }
    finally
      {
        console.warn = warn;
      }
    assert.match(warned[0], /budget is used up/);
  });

test("the email task skips when Gmail has no token, and runs the check when it does", async () =>
  {
    const asked = [];
    const check = { run: async (options) => (asked.push(options.token), { moved: 1 }) };
    assert.deepEqual(await (await new EmailTask({ check, tokens: offline }).start({}, {})).perform(), { skipped: "Gmail isn't connected." });
    assert.deepEqual(await (await new EmailTask({ check, tokens: connected }).start({}, {})).perform(), { moved: 1 });
    assert.deepEqual(asked, ["tok"]);
  });

test("the runner runs a task with perform() without building an agent, and email checks don't use up the day's runs", async () =>
  {
    const store = new MemoryRunStore();
    const logs = new Map();
    const buildAgent = () =>
      {
        throw new Error("no agent should be built");
      };
    const tasks = new Map([["email", new EmailTask({ check: { run: async () => ({ moved: 2 }) }, tokens: connected })]]);
    const logFor = (id) =>
      {
        logs.set(id, new MemoryLog());
        return logs.get(id);
      };
    const runner = new Runner({ store, cap: new SpendingCap({ store, maxRuns: 1, maxUsd: 1 }), tasks, buildAgent, logFor });
    const first = await runner.submit("email");
    const second = await runner.submit("email");
    await runner.idle();
    assert.deepEqual(logs.get(first.id).result, { moved: 2 });
    assert.deepEqual(logs.get(second.id).events, ["start", "finish"]);
    assert.equal(first.budget, 0.02);
  });

test("a token Gmail turns down is dropped, so the next tick asks Google again", async () =>
  {
    let dropped = 0;
    const tokens = { ...connected, drop: () => dropped++ };
    const check = { hasNew: async () => { throw Object.assign(new Error("Gmail answered 401"), { status: 401 }); } };
    const timer = new MailTimer({ runner: { submit: async () => ({ id: "x" }) }, store: { find: async () => null }, tokens, check, everyMs: 60_000 });
    const warn = console.warn;
    console.warn = () => {};
    try
      {
        assert.equal(await timer.tick(), null);
      }
    finally
      {
        console.warn = warn;
      }
    assert.equal(dropped, 1);
  });

test("an email run Gmail turns down drops the token and fails", async () =>
  {
    let dropped = 0;
    const tokens = { ...connected, drop: () => dropped++ };
    const check = { run: async () => { throw Object.assign(new Error("Gmail answered 401"), { status: 401 }); } };
    const work = await new EmailTask({ check, tokens }).start({}, {});
    await assert.rejects(work.perform(), /401/);
    assert.equal(dropped, 1);
  });
