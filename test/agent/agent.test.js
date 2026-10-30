import { test } from "node:test";
import assert from "node:assert/strict";
import { Agent } from "../../src/agent/Agent.js";
import { Toolbox } from "../../src/agent/Toolbox.js";
import { Model } from "../../src/agent/Model.js";
import { RunBudget } from "../../src/agent/RunBudget.js";
import { ScriptedAi, MemoryLog, toolCall } from "../fakes.js";

const echo = { name: "echo", description: "Says it back.", parameters: { type: "object", properties: { text: { type: "string" } } }, run: async ({ text }) => ({ said: text }) };
const broken =
  {
    name: "broken",
    description: "Always fails.",
    parameters: { type: "object" },
    run: async () =>
      {
        throw new Error("site is down");
      },
  };

const agentWith = (replies, tools = [echo]) =>
  {
    const ai = new ScriptedAi(replies);
    const log = new MemoryLog();
    return { ai, log, agent: new Agent({ ai, toolbox: new Toolbox(tools), log, maxSteps: 3 }) };
  };

test("an answer with no tool call ends the run", async () =>
  {
    const { agent, ai } = agentWith([{ role: "assistant", content: "Done." }]);
    assert.equal(await agent.run({ system: "Be brief.", task: "Say done." }), "Done.");
    assert.equal(ai.calls.length, 1);
  });

test("a tool's answer goes back to the model tied to its call", async () =>
  {
    const { agent, ai, log } = agentWith(
      [
        { role: "assistant", content: "Checking.", tool_calls: [toolCall("c1", "echo", { text: "hi" })] },
        { role: "assistant", content: "It said hi." },
      ]);

    assert.equal(await agent.run({ system: "s", task: "t" }), "It said hi.");
    const toolMessage = ai.calls[1].messages.at(-1);
    assert.deepEqual(toolMessage, { role: "tool", tool_call_id: "c1", content: "{\"said\":\"hi\"}" });
    assert.deepEqual(log.steps.map((step) => step.type), ["message", "tool"]);
  });

test("the model sees the tools but never their code", async () =>
  {
    const { agent, ai } = agentWith([{ role: "assistant", content: "ok" }]);
    await agent.run({ system: "s", task: "t" });
    assert.deepEqual(ai.calls[0].tools, [{ type: "function", function: { name: "echo", description: "Says it back.", parameters: echo.parameters } }]);
  });

test("every reply gets billed to the run at the model's price", async () =>
  {
    const { agent, log } = agentWith(
      [
        { role: "assistant", content: "", tool_calls: [toolCall("c1", "echo", { text: "a" })] },
        { role: "assistant", content: "ok" },
      ]);

    await agent.run({ system: "s", task: "t" });
    assert.equal(log.usage.length, 2);
    // 1000 in at $1 and 100 out at $2 per million.
    assert.equal(log.usage[0].cost, 0.0012);
  });

test("a broken tool, a made-up tool and bad JSON don't end the run", async () =>
  {
    const { agent, ai, log } = agentWith(
      [
        { role: "assistant", content: "", tool_calls: [toolCall("c1", "broken", {}), toolCall("c2", "nope", {}), toolCall("c3", "echo", "{not json")] },
        { role: "assistant", content: "Recovered." },
      ], [echo, broken]);

    assert.equal(await agent.run({ system: "s", task: "t" }), "Recovered.");
    const results = ai.calls[1].messages.slice(-3).map((message) => message.content);
    assert.deepEqual(results, ["Error: site is down", "Error: There's no tool called \"nope\".", "Error: Those arguments weren't valid JSON."]);
    assert.equal(log.steps.filter((step) => step.type === "error").length, 3);
  });

// Together turns away a tool message with no content (400, missing field 'content'), so an empty answer has to go
// back as words.
test("a tool that hands back nothing still answers the model", async () =>
  {
    const silent = (name, value) => ({ name, description: "Returns nothing useful.", parameters: { type: "object" }, run: async () => value });
    const { agent, ai } = agentWith(
      [
        { role: "assistant", content: "", tool_calls: [toolCall("c1", "nothing", {}), toolCall("c2", "blank", {}), toolCall("c3", "zero", {})] },
        { role: "assistant", content: "ok" },
      ], [silent("nothing", undefined), silent("blank", ""), silent("zero", 0)]);

    assert.equal(await agent.run({ system: "s", task: "t" }), "ok");
    const results = ai.calls[1].messages.slice(-3).map((message) => message.content);
    assert.deepEqual(results, ["(no output)", "(no output)", "0"]);
  });

test("a model that never stops gets cut off", async () =>
  {
    const loop = Array.from({ length: 5 }, (_, i) => ({ role: "assistant", content: "", tool_calls: [toolCall(`c${i}`, "echo", { text: "again" })] }));
    const { agent, ai } = agentWith(loop);
    await assert.rejects(agent.run({ system: "s", task: "t" }), /Gave up after 3 steps/);
    assert.equal(ai.calls.length, 3);
  });

test("extras the model sends back don't get resent", async () =>
  {
    const { agent, ai } = agentWith(
      [
        { role: "assistant", content: "", reasoning_content: "secret thinking", tool_calls: [toolCall("c1", "echo", { text: "a" })] },
        { role: "assistant", content: "ok" },
      ]);

    await agent.run({ system: "s", task: "t" });
    assert.equal("reasoning_content" in ai.calls[1].messages[2], false);
  });

// 3 cents a reply, since ScriptedAi always reports 1,000 tokens in.
const pricey = new Model({ rung: 1, name: "Pricey", id: "fake/pricey", priceIn: 30, priceOut: 0, abilities: ["tools"] });

test("a run stops before the model call that would go past its budget", async () =>
  {
    const ai = new ScriptedAi(Array.from({ length: 12 }, (_, i) => ({ role: "assistant", content: null, tool_calls: [toolCall(`c${i}`, "echo", { text: "again" })] })), pricey);
    const log = new MemoryLog();
    const budget = new RunBudget(0.1);
    const agent = new Agent({ ai, toolbox: new Toolbox([echo]), log, maxSteps: 12, budget });

    await assert.rejects(agent.run({ system: "s", task: "t" }), /This run used its \$0\.10 budget/);
    assert.equal(ai.calls.length, 4);
    assert.equal(log.usage.length, 4);
    assert.equal(budget.spent.toFixed(2), "0.12");
  });

test("a run under its budget finishes and is charged what the log bills", async () =>
  {
    const ai = new ScriptedAi([{ role: "assistant", content: null, tool_calls: [toolCall("c1", "echo", { text: "hi" })] }, { role: "assistant", content: "Done." }]);
    const log = new MemoryLog();
    const budget = new RunBudget(0.1);
    const agent = new Agent({ ai, toolbox: new Toolbox([echo]), log, budget });

    assert.equal(await agent.run({ system: "s", task: "t" }), "Done.");
    assert.equal(budget.spent, log.usage.reduce((total, entry) => total + entry.cost, 0));
  });
