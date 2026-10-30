import { test } from "node:test";
import assert from "node:assert/strict";
import { Runner } from "../../src/agent/Runner.js";
import { SpendingCap } from "../../src/agent/SpendingCap.js";
import { Agent } from "../../src/agent/Agent.js";
import { Toolbox } from "../../src/agent/Toolbox.js";
import { Model } from "../../src/agent/Model.js";
import { MemoryLog, MemoryRunStore, ScriptedAi, toolCall } from "../fakes.js";

const task = { brief: async (run) => ({ system: "s", task: `job ${run.job}` }) };

// An agent that takes a moment, so the test can see how many run at once.
const slowAgents = () =>
  {
    const stats = { live: 0, most: 0 };
    const buildAgent = () => (
      {
        run: async ({ task: text }) =>
          {
            stats.live++;
            stats.most = Math.max(stats.most, stats.live);
            await new Promise((resolve) => setTimeout(resolve, 20));
            stats.live--;
            return `found someone for ${text}`;
          },
      });
    return { stats, buildAgent };
  };

const runnerWith = ({ store = new MemoryRunStore(), buildAgent, maxRuns = 20, maxUsd = 1, runUsd, tasks = new Map([["contact", task]]) }) =>
  {
    const logs = new Map();
    const logFor = (runId) =>
      {
        logs.set(runId, new MemoryLog());
        return logs.get(runId);
      };
    const cap = new SpendingCap({ store, maxRuns, maxUsd });
    return { logs, runner: new Runner({ store, cap, tasks, buildAgent, logFor, runUsd }) };
  };

test("a run comes back queued and finishes in the background", async () =>
  {
    const { buildAgent } = slowAgents();
    const { runner, logs } = runnerWith({ buildAgent });

    const run = await runner.submit("contact", "job-1");
    assert.equal(logs.has(run.id), true);
    await runner.idle();
    assert.deepEqual(logs.get(run.id).events, ["start", "finish"]);
    assert.equal(logs.get(run.id).result, "found someone for job job-1");
  });

test("no more than two run at once", async () =>
  {
    const { stats, buildAgent } = slowAgents();
    const { runner, logs } = runnerWith({ buildAgent });

    for(let i = 0; i < 5; i++) await runner.submit("contact", `job-${i}`);
    await runner.idle();
    assert.equal(stats.most, 2);
    assert.equal([...logs.values()].every((log) => log.events.at(-1) === "finish"), true);
  });

test("an agent that blows up marks its run failed", async () =>
  {
    const fail = async () =>
      {
        throw new Error("Together said no");
      };
    const buildAgent = () => ({ run: fail });
    const { runner, logs } = runnerWith({ buildAgent });

    const run = await runner.submit("contact", "job-1");
    await runner.idle();
    assert.equal(logs.get(run.id).error, "Together said no");
  });

test("an unknown kind of run is a 400", async () =>
  {
    const { runner } = runnerWith({ buildAgent: slowAgents().buildAgent });
    await assert.rejects(runner.submit("gmail", "job-1"), (error) => error.status === 400);
  });

test("the daily run limit turns new runs away", async () =>
  {
    const { runner } = runnerWith({ buildAgent: slowAgents().buildAgent, maxRuns: 2 });
    await runner.submit("contact", "a");
    await runner.submit("contact", "b");
    await assert.rejects(runner.submit("contact", "c"), (error) => error.status === 429);
    await runner.idle();
  });

test("runs pressed at the same moment still stop at the daily limit", async () =>
  {
    const { runner } = runnerWith({ buildAgent: slowAgents().buildAgent, maxRuns: 2 });
    const results = await Promise.allSettled(["a", "b", "c", "d", "e", "f"].map((job) => runner.submit("contact", job)));
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 2);
    assert.equal(results.filter((result) => result.reason?.status === 429).length, 4);
    await runner.idle();
  });

test("a save that never answers times out and lets the next run in", async () =>
  {
    const store = new MemoryRunStore();
    const create = store.create.bind(store);
    store.create = async () =>
      {
        store.create = create;
        return new Promise(() => {});
      };
    const cap = new SpendingCap({ store, maxRuns: 20, maxUsd: 1 });
    const runner = new Runner({ store, cap, tasks: new Map([["contact", task]]), buildAgent: slowAgents().buildAgent, logFor: () => new MemoryLog(), admitMs: 30 });

    const stuck = runner.submit("contact", "a");
    const next = runner.submit("contact", "b");
    await assert.rejects(stuck, /Starting a run took longer than/);
    assert.equal((await next).job, "b");
    await runner.idle();
  });

test("the daily budget turns new runs away", async () =>
  {
    const store = new MemoryRunStore([{ id: "old", cost: 1.5, createdAt: new Date() }]);
    const { runner } = runnerWith({ store, buildAgent: slowAgents().buildAgent, maxUsd: 1 });
    await assert.rejects(runner.submit("contact", "a"), /AI budget is used up/);
  });

test("yesterday's spending doesn't count against today", async () =>
  {
    const yesterday = new Date(Date.now() - 36 * 60 * 60 * 1000);
    const store = new MemoryRunStore([{ id: "old", cost: 5, createdAt: yesterday }]);
    const cap = new SpendingCap({ store, maxRuns: 20, maxUsd: 1 });
    assert.equal(await cap.spentToday(), 0);
    await cap.check();
  });

test("runs pressed together can't hold more than the day's budget between them", async () =>
  {
    const { runner } = runnerWith({ buildAgent: slowAgents().buildAgent, maxUsd: 1, runUsd: 0.5 });
    const results = await Promise.allSettled(["a", "b", "c"].map((job) => runner.submit("contact", job)));
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 2);
    assert.equal(results.filter((result) => result.reason?.status === 429).length, 1);
    await runner.idle();
  });

test("a run still going counts as its whole budget, and an ended one as what it spent", async () =>
  {
    const now = new Date();
    const store = new MemoryRunStore(
      [
        { id: "done", status: "done", cost: 0.02, budget: 0.5, createdAt: now },
        { id: "failed", status: "failed", cost: 0.03, budget: 0.5, createdAt: now },
        { id: "live", status: "running", cost: 0.02, budget: 0.5, createdAt: now },
        { id: "over", status: "running", cost: 0.6, budget: 0.5, createdAt: now },
      ]);
    const cap = new SpendingCap({ store, maxRuns: 20, maxUsd: 5 });
    assert.equal((await cap.spentToday()).toFixed(2), "1.15");
  });

test("a new run's whole budget has to fit in what's left of the day", async () =>
  {
    const store = new MemoryRunStore([{ id: "old", status: "done", cost: 0.95, createdAt: new Date() }]);
    const tight = runnerWith({ store, buildAgent: slowAgents().buildAgent, maxUsd: 1, runUsd: 0.1 });
    await assert.rejects(tight.runner.submit("contact", "a"), /doesn't have room for another run/);

    const small = runnerWith({ store, buildAgent: slowAgents().buildAgent, maxUsd: 1, runUsd: 0.05 });
    assert.equal((await small.runner.submit("contact", "b")).budget, 0.05);
    await small.runner.idle();
  });

test("a task's own budget goes on its run and to its agent", async () =>
  {
    let given;
    const buildAgent = ({ budget }) =>
      {
        given = budget;
        return { run: async () => "ok" };
      };
    const { runner } = runnerWith({ buildAgent, tasks: new Map([["contact", { ...task, maxUsd: 0.25 }]]) });

    const run = await runner.submit("contact", "a");
    await runner.idle();
    assert.equal(run.budget, 0.25);
    assert.equal(given.maxUsd, 0.25);
  });

test("a run that keeps spending fails with its budget message and frees its slot", async () =>
  {
    const pricey = new Model({ rung: 1, name: "Pricey", id: "fake/pricey", priceIn: 30, priceOut: 0, abilities: ["tools"] });
    const echo = { name: "echo", description: "Says it back.", parameters: { type: "object" }, run: async () => "again" };
    const looping = () => new ScriptedAi(Array.from({ length: 12 }, (_, i) => ({ role: "assistant", content: null, tool_calls: [toolCall(`c${i}`, "echo", {})] })), pricey);
    let built = 0;
    const buildAgent = ({ log, budget }) =>
      {
        built++;
        if(built === 2) return { run: async () => "second run worked" };
        return new Agent({ ai: looping(), toolbox: new Toolbox([echo]), log, maxSteps: 12, budget });
      };
    const store = new MemoryRunStore();
    const logs = new Map();
    const logFor = (runId) =>
      {
        logs.set(runId, new MemoryLog());
        return logs.get(runId);
      };
    const cap = new SpendingCap({ store, maxRuns: 20, maxUsd: 1 });
    const runner = new Runner({ store, cap, tasks: new Map([["contact", task]]), buildAgent, logFor, slots: 1 });

    const runaway = await runner.submit("contact", "a");
    const next = await runner.submit("contact", "b");
    await runner.idle();
    assert.equal(logs.get(runaway.id).error, "This run used its $0.10 budget.");
    assert.equal(logs.get(runaway.id).usage.length, 4);
    assert.equal(logs.get(next.id).result, "second run worked");
  });
