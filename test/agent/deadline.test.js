import { test } from "node:test";
import assert from "node:assert/strict";
import { Deadline, DeadlineError } from "../../src/agent/Deadline.js";
import { Agent } from "../../src/agent/Agent.js";
import { Toolbox } from "../../src/agent/Toolbox.js";
import { Runner } from "../../src/agent/Runner.js";
import { SpendingCap } from "../../src/agent/SpendingCap.js";
import { ScriptedAi, MemoryLog, MemoryRunStore, toolCall } from "../fakes.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const never = () => new Promise(() => {});

test("work that finishes in time comes back as is", async () =>
  {
    const deadline = new Deadline(200, "Quick job");
    assert.equal(await deadline.race(wait(10).then(() => "done")), "done");
    assert.equal(deadline.signal.aborted, false);
  });

test("work that runs over fails and its signal flips", async () =>
  {
    const deadline = new Deadline(30, "Slow job");
    await assert.rejects(deadline.race(never()), (error) => error instanceof DeadlineError && /Slow job took longer than/.test(error.message));
    assert.equal(deadline.signal.aborted, true);
  });

test("the time limit reads like a person wrote it", () =>
  {
    assert.equal(new Deadline(180_000, "x").length(), "3 minutes");
    assert.equal(new Deadline(60_000, "x").length(), "1 minute");
    assert.equal(new Deadline(20_000, "x").length(), "20 seconds");
  });

test("a tool that never answers times out and the run carries on", async () =>
  {
    let toolSignal;
    const hang =
      {
        name: "hang",
        description: "Never answers.",
        parameters: { type: "object" },
        run: (args, { signal }) =>
          {
            toolSignal = signal;
            return never();
          },
      };
    const ai = new ScriptedAi([{ role: "assistant", content: "", tool_calls: [toolCall("c1", "hang", {})] }, { role: "assistant", content: "Moved on." }]);
    const log = new MemoryLog();
    const agent = new Agent({ ai, toolbox: new Toolbox([hang], { toolMs: 30 }), log });

    assert.equal(await agent.run({ system: "s", task: "t" }), "Moved on.");
    assert.match(ai.calls[1].messages.at(-1).content, /^Error: The tool took longer than/);
    assert.match(log.steps.at(-1).text, /^hang: The tool took longer than/);
    assert.equal(toolSignal.aborted, true);
    assert.equal(log.steps.at(-1).type, "error");
  });

test("a run whose time is up doesn't ask the model again", async () =>
  {
    const controller = new AbortController();
    const slow =
      {
        name: "slow",
        description: "Takes a while.",
        parameters: { type: "object" },
        run: async () =>
          {
            controller.abort(new DeadlineError("This run took longer than 3 minutes."));
            return "late answer";
          },
      };
    const ai = new ScriptedAi([{ role: "assistant", content: "", tool_calls: [toolCall("c1", "slow", {})] }, { role: "assistant", content: "never sent" }]);
    const agent = new Agent({ ai, toolbox: new Toolbox([slow]), log: new MemoryLog(), signal: controller.signal });

    await assert.rejects(agent.run({ system: "s", task: "t" }), /This run took longer than 3 minutes/);
    assert.equal(ai.calls.length, 1);
  });

test("a run that never finishes fails on time and frees its slot", async () =>
  {
    const store = new MemoryRunStore();
    const logs = new Map();
    const logFor = (runId) =>
      {
        logs.set(runId, new MemoryLog());
        return logs.get(runId);
      };
    let built = 0;
    const buildAgent = () =>
      {
        built++;
        return { run: built === 1 ? never : async () => "second run worked" };
      };
    const task = { start: async () => ({ brief: () => ({ system: "s", task: "t" }), tools: () => [], result: (answer) => answer }) };
    const cap = new SpendingCap({ store, maxRuns: 20, maxUsd: 1 });
    const runner = new Runner({ store, cap, tasks: new Map([["contact", task]]), buildAgent, logFor, slots: 1, runMs: 40 });

    const stuck = await runner.submit("contact", "a");
    const next = await runner.submit("contact", "b");
    await runner.idle();
    assert.match(logs.get(stuck.id).error, /This run took longer than/);
    assert.equal(logs.get(next.id).result, "second run worked");
  });
