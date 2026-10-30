import { test } from "node:test";
import assert from "node:assert/strict";
import { StreamedReply } from "../../src/agent/StreamedReply.js";
import { AiClient } from "../../src/agent/AiClient.js";
import { Agent } from "../../src/agent/Agent.js";
import { Toolbox } from "../../src/agent/Toolbox.js";
import { ScriptedAi, MemoryLog, StreamingSdk, cheapModel, chunk, usageChunk, toolCall } from "../fakes.js";

const echo = { name: "echo", description: "Says it back.", parameters: { type: "object", properties: { text: { type: "string" } } }, run: async ({ text }) => ({ said: text }) };

const replyOf = (chunks) =>
  {
    const reply = new StreamedReply();
    chunks.forEach((piece) => reply.add(piece));
    return reply;
  };

// Two calls in one reply, cut up the way GLM 5.3 sends them: id and name first, then the arguments in bits.
const twoCalls =
  [
    chunk({ role: "assistant", content: "" }),
    chunk({ content: "I'll check " }),
    chunk({ content: "both." }),
    chunk({ tool_calls: [{ index: 0, id: "call_a", type: "function", function: { name: "get_weather", arguments: "" } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: "{\"city\":" } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: "\"Kampala\"}" } }] }),
    chunk({ tool_calls: [{ index: 1, id: "call_b", type: "function", function: { name: "get_weather", arguments: "{\"city\":\"Nai" } }] }),
    chunk({ tool_calls: [{ index: 1, function: { arguments: "robi\"}" } }] }),
    { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    usageChunk(189, 60),
  ];

test("a streamed reply is joined back into one message", () =>
  {
    const reply = replyOf(twoCalls);
    assert.deepEqual(reply.message(),
      {
        role: "assistant",
        content: "I'll check both.",
        tool_calls:
          [
            { id: "call_a", type: "function", function: { name: "get_weather", arguments: "{\"city\":\"Kampala\"}" } },
            { id: "call_b", type: "function", function: { name: "get_weather", arguments: "{\"city\":\"Nairobi\"}" } },
          ],
      });
    assert.deepEqual(reply.tokens(), { input: 189, output: 60 });
  });

test("usage is read from whichever chunk carries it", () =>
  {
    // DeepSeek sends the usage on a chunk that still has a choice in it.
    const reply = replyOf([chunk({ content: "Hi" }), { choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 322, completion_tokens: 93 } }]);
    assert.deepEqual(reply.tokens(), { input: 322, output: 93 });
    assert.deepEqual(reply.message(), { role: "assistant", content: "Hi" });
  });

test("a call with parts missing still comes out in full", () =>
  {
    const reply = replyOf(
      [
        chunk({ tool_calls: [{ index: 0, id: "c1", type: "function" }] }),
        chunk({ tool_calls: [{ index: 1, type: "function", function: { name: "echo", arguments: { text: "hi" } } }] }),
        chunk({ tool_calls: [{ function: { name: "echo", arguments: "{\"text\":" } }] }),
        chunk({ tool_calls: [{ function: { arguments: "\"yo\"}" } }] }),
      ]);
    assert.deepEqual(reply.message().tool_calls,
      [
        { id: "c1", type: "function", function: { name: "", arguments: "" } },
        { id: "call_1", type: "function", function: { name: "echo", arguments: "{\"text\":\"hi\"}{\"text\":\"yo\"}" } },
      ]);
  });

test("the client asks for a stream with usage, and leaves tools off when there are none", async () =>
  {
    const sdk = new StreamingSdk([twoCalls, [chunk({ content: "ok" }), usageChunk(1, 1)]]);
    const client = new AiClient({ sdk, model: cheapModel });

    const first = await client.complete([{ role: "user", content: "hi" }], [{ type: "function", function: { name: "get_weather" } }]);
    await client.complete([{ role: "user", content: "hi" }]);

    assert.equal(first.message.tool_calls.length, 2);
    assert.deepEqual(first.tokens, { input: 189, output: 60 });
    assert.equal(sdk.requests[0].stream, true);
    assert.deepEqual(sdk.requests[0].stream_options, { include_usage: true });
    assert.equal(sdk.requests[0].model, "fake/cheap");
    assert.equal("tools" in sdk.requests[1], false);
  });

test("a reply that stalls halfway is cut off by its own deadline", async () =>
  {
    const stall = async function* (signal)
      {
        yield chunk({ content: "Hel" });
        await new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
      };
    const sdk = new StreamingSdk([stall]);
    const client = new AiClient({ sdk, model: cheapModel, replyMs: 50 });

    const started = Date.now();
    await assert.rejects(client.complete([{ role: "user", content: "hi" }]), /The model's reply took longer than/);
    assert.ok(Date.now() - started < 1000);
    assert.equal(sdk.signals[0].aborted, true);
  });

test("the run's signal reaches the request", async () =>
  {
    const sdk = new StreamingSdk([[chunk({ content: "ok" })]]);
    const run = new AbortController();
    await new AiClient({ sdk, model: cheapModel }).complete([{ role: "user", content: "hi" }], [], run.signal);

    assert.equal(sdk.signals[0].aborted, false);
    run.abort(new Error("run over"));
    assert.equal(sdk.signals[0].aborted, true);
  });

// The SDK ends a cut-off stream without an error. Here the stream stops quietly as soon as the run is over.
test("a reply cut off by the run's deadline is an error, not half a reply", async () =>
  {
    const run = new AbortController();
    const quietStop = async function* (signal)
      {
        yield chunk({ content: "Half an ans" });
        run.abort(new Error("This run took longer than 3 minutes."));
        if(signal.aborted) return;
        yield chunk({ content: "wer." });
      };
    const sdk = new StreamingSdk([quietStop]);

    await assert.rejects(new AiClient({ sdk, model: cheapModel }).complete([{ role: "user", content: "hi" }], [], run.signal), /This run took longer than 3 minutes/);
  });

test("a streamed call with no tool name gets an error back and the run carries on", async () =>
  {
    const sdk = new StreamingSdk(
      [
        [chunk({ tool_calls: [{ index: 0, id: "c1", type: "function" }] }), usageChunk(10, 5)],
        [chunk({ content: "Sorry, done." }), usageChunk(10, 5)],
      ]);
    const log = new MemoryLog();
    const agent = new Agent({ ai: new AiClient({ sdk, model: cheapModel }), toolbox: new Toolbox([echo]), log, maxSteps: 3 });

    assert.equal(await agent.run({ system: "s", task: "t" }), "Sorry, done.");
    const history = sdk.requests[1].messages;
    assert.deepEqual(history.at(-2).tool_calls, [{ id: "c1", type: "function", function: { name: "", arguments: "{}" } }]);
    assert.deepEqual(history.at(-1), { role: "tool", tool_call_id: "c1", content: "Error: That tool call had no tool name." });
    assert.deepEqual(log.steps.map((step) => step.type), ["tool", "error"]);
  });

// Problem #5 as it was found: a reply whose tool call has no function part.
test("a tool call with no function part doesn't end the run", async () =>
  {
    const ai = new ScriptedAi([{ role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function" }] }, { role: "assistant", content: "Done." }]);
    const agent = new Agent({ ai, toolbox: new Toolbox([echo]), log: new MemoryLog(), maxSteps: 3 });

    assert.equal(await agent.run({ system: "s", task: "t" }), "Done.");
    assert.equal(ai.calls[1].messages.at(-1).content, "Error: That tool call had no tool name.");
    assert.deepEqual(ai.calls[1].messages.at(-2).tool_calls, [{ id: "c1", type: "function", function: { name: "", arguments: "{}" } }]);
  });

test("broken arguments are resent as {}, and the model hears they were broken", async () =>
  {
    const ai = new ScriptedAi([{ role: "assistant", content: "", tool_calls: [toolCall("c1", "echo", "{\"text\": \"hi")] }, { role: "assistant", content: "Done." }]);
    const agent = new Agent({ ai, toolbox: new Toolbox([echo]), log: new MemoryLog(), maxSteps: 3 });

    await agent.run({ system: "s", task: "t" });
    assert.equal(ai.calls[1].messages.at(-2).tool_calls[0].function.arguments, "{}");
    assert.equal(ai.calls[1].messages.at(-1).content, "Error: Those arguments weren't valid JSON.");
  });
