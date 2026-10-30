import { test } from "node:test";
import assert from "node:assert/strict";
import { Runner } from "../../src/agent/Runner.js";
import { SpendingCap } from "../../src/agent/SpendingCap.js";
import { MemoryLog, MemoryRunStore } from "../fakes.js";

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

const runnerWith = ({ store = new MemoryRunStore(), buildAgent, maxRuns = 20, maxUsd = 1 }) =>
  {
    const logs = new Map();
    const logFor = (runId) =>
      {
        logs.set(runId, new MemoryLog());
        return logs.get(runId);
      };
    const cap = new SpendingCap({ store, maxRuns, maxUsd });
    return { logs, runner: new Runner({ store, cap, tasks: new Map([["contact", task]]), buildAgent, logFor }) };
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
