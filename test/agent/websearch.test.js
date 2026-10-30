import { test } from "node:test";
import assert from "node:assert/strict";
import { ExaClient } from "../../src/agent/ExaClient.js";
import { WebSearch } from "../../src/agent/tools/WebSearch.js";
import { Toolbox } from "../../src/agent/Toolbox.js";
import { Agent } from "../../src/agent/Agent.js";
import { RunBudget } from "../../src/agent/RunBudget.js";
import { RunLog } from "../../src/agent/RunLog.js";
import { SEARCH_USD } from "../../src/agent/ExaClient.js";
import { FakeFetch, jsonResponse, ScriptedAi, MemoryLog, toolCall } from "../fakes.js";

// A LinkedIn result shaped like the one Exa sent back for "Linear engineering manager" on 2026-10-30.
const profile =
  {
    title: "Sam Rivera",
    url: "https://linkedin.com/in/samrivera",
    publishedDate: "2026-10-21T19:56:37.000Z",
    highlights: ["# Sam Rivera\n\n  Engineering Manager at Linear", "Hiring   for the sync team."],
    entities:
      [
        {
          type: "person",
          properties:
            {
              name: "Sam Rivera",
              workHistory:
                [
                  { title: "Engineering Manager", dates: { from: "2022-06-01", to: null }, company: { name: "Linear" } },
                  { title: "Staff Engineer", dates: { from: "2017-09-01", to: "2022-05-01" }, company: { name: "Uber" } },
                ],
            },
        },
      ],
  };

const searchWith = (answers) =>
  {
    const fake = new FakeFetch(answers);
    return { fake, tool: new WebSearch({ exa: new ExaClient({ apiKey: "test-key", fetch: fake.fetch }) }) };
  };

test("the search goes to Exa the way its guide says: query and highlights, nothing else", async () =>
  {
    const { fake, tool } = searchWith([jsonResponse(200, { results: [] })]);
    const signal = new AbortController().signal;
    await tool.run({ query: "  Linear engineering manager " }, { signal });

    const [request] = fake.requests;
    assert.equal(request.url, "https://api.exa.ai/search");
    assert.equal(request.method, "POST");
    assert.equal(request.headers["x-api-key"], "test-key");
    assert.deepEqual(request.body, { query: "Linear engineering manager", type: "auto", contents: { highlights: true } });
    assert.equal(request.signal, signal);
  });

test("a result reads as title, link, date, current job and highlights", async () =>
  {
    const { tool } = searchWith([jsonResponse(200, { results: [profile] })]);
    const text = await tool.run({ query: "Linear engineering manager" });

    assert.equal(text,
      [
        "[1] Sam Rivera",
        "https://linkedin.com/in/samrivera",
        "Published 2026-10-21",
        "Current job: Engineering Manager at Linear, since 2022-06",
        "# Sam Rivera Engineering Manager at Linear … Hiring for the sync team.",
      ].join("\n"));
  });

test("a past job isn't shown as a current one", async () =>
  {
    const { tool } = searchWith([jsonResponse(200, { results: [profile] })]);
    assert.doesNotMatch(await tool.run({ query: "q" }), /Uber/);
  });

test("a result with only a link still reads cleanly, and results are numbered", async () =>
  {
    const { tool } = searchWith([jsonResponse(200, { results: [{ url: "https://a.com" }, { title: "B", url: "https://b.com", highlights: [] }] })]);
    assert.equal(await tool.run({ query: "q" }), "[1] (no title)\nhttps://a.com\n\n[2] B\nhttps://b.com");
  });

test("no results tells the model so instead of sending nothing", async () =>
  {
    const { tool } = searchWith([jsonResponse(200, { results: [] })]);
    assert.equal(await tool.run({ query: "nobody at all" }), "No results for \"nobody at all\".");
  });

test("a missing, blank or non-text query never becomes a paid search", async () =>
  {
    const { fake, tool } = searchWith([]);
    for(const args of [{}, { query: "   " }, { query: 42 }, null])
      {
        await assert.rejects(tool.run(args), /web_search needs a query/);
      }
    assert.equal(fake.requests.length, 0);
  });

test("a rambling query is refused before it's sent", async () =>
  {
    const { fake, tool } = searchWith([]);
    await assert.rejects(tool.run({ query: "x".repeat(301) }), /301 characters\. Keep it under 300/);
    assert.equal(fake.requests.length, 0);
  });

test("a bad key says to fix .env, since the model can't", async () =>
  {
    const { tool } = searchWith([jsonResponse(401, { error: "Invalid API key.", tag: "INVALID_API_KEY" })]);
    await assert.rejects(tool.run({ query: "q" }), /Exa refused the API key\. Check EXA_API_KEY/);
  });

test("too many searches says to wait", async () =>
  {
    const { tool } = searchWith([jsonResponse(429, { error: "Rate limit" })]);
    await assert.rejects(tool.run({ query: "q" }), /too many searches/);
  });

test("any other refusal passes on Exa's reason, cut short", async () =>
  {
    const { tool } = searchWith([jsonResponse(400, { error: `Invalid request body ${"x".repeat(500)}` })]);
    await assert.rejects(tool.run({ query: "q" }), (error) => error.message.startsWith("Exa said no (400): Invalid request body") && error.message.length < 230);
  });

test("an HTML error page from something in the way still reads as a reason", async () =>
  {
    const { tool } = searchWith([new Response("<html>Bad gateway</html>", { status: 502 })]);
    await assert.rejects(tool.run({ query: "q" }), /Exa said no \(502\): <html>Bad gateway<\/html>/);
  });

test("a search that hangs is stopped by the tool's time limit, and the fetch is told to stop", async () =>
  {
    let seen;
    const hang = (signal) =>
      {
        seen = signal;
        return new Promise(() => {});
      };
    const { tool } = searchWith([hang]);

    await assert.rejects(new Toolbox([tool], { toolMs: 30 }).call("web_search", { query: "q" }), /took longer than/);
    assert.equal(seen.aborted, true);
  });

test("in a run, the model gets the results back as the tool's answer", async () =>
  {
    const { tool } = searchWith([jsonResponse(200, { results: [profile] })]);
    const ai = new ScriptedAi(
      [
        { role: "assistant", content: "", tool_calls: [toolCall("c1", "web_search", { query: "Linear engineering manager" })] },
        { role: "assistant", content: "Sam Rivera." },
      ]);
    const agent = new Agent({ ai, toolbox: new Toolbox([tool]), log: new MemoryLog(), maxSteps: 3 });

    assert.equal(await agent.run({ system: "s", task: "t" }), "Sam Rivera.");
    const answer = ai.calls[1].messages.at(-1);
    assert.equal(answer.tool_call_id, "c1");
    assert.match(answer.content, /Current job: Engineering Manager at Linear/);
    assert.deepEqual(ai.calls[0].tools[0].function.name, "web_search");
  });

// Problem #23: a search costs money at Exa, so it has to count against the run's budget and the day's cap the same
// way a model reply does.

// Collects what a tool charges, the way the agent's charge would.
const charges = () =>
  {
    const paid = [];
    return { paid, charge: async (cost) => paid.push(cost) };
  };

test("a search charges the run what Exa says it cost", async () =>
  {
    const { tool } = searchWith([jsonResponse(200, { results: [profile], costDollars: { total: 0.012 } })]);
    const { paid, charge } = charges();
    await tool.run({ query: "q" }, { charge });
    assert.deepEqual(paid, [0.012]);
  });

test("a search with no results is still charged, because Exa still billed it", async () =>
  {
    const { tool } = searchWith([jsonResponse(200, { results: [], costDollars: { total: 0.007 } })]);
    const { paid, charge } = charges();
    assert.equal(await tool.run({ query: "nobody" }, { charge }), "No results for \"nobody\".");
    assert.deepEqual(paid, [0.007]);
  });

test("a price that's missing, negative or not a number is charged at the usual price, never as free", async () =>
  {
    const replies = [{}, { costDollars: {} }, { costDollars: { total: -5 } }, { costDollars: { total: "0.007" } }, { costDollars: { total: null } }];
    const { tool } = searchWith(replies.map((extra) => jsonResponse(200, { results: [], ...extra })));
    const { paid, charge } = charges();
    for(let i = 0; i < replies.length; i++) await tool.run({ query: "q" }, { charge });
    assert.deepEqual(paid, Array(replies.length).fill(SEARCH_USD));
  });

test("a refused query and a failed search charge nothing", async () =>
  {
    const { tool } = searchWith([jsonResponse(500, { error: "down" })]);
    const { paid, charge } = charges();
    await assert.rejects(tool.run({ query: "" }, { charge }), /needs a query/);
    await assert.rejects(tool.run({ query: "q" }, { charge }), /Exa said no \(500\)/);
    assert.deepEqual(paid, []);
  });

test("in a run, a search is charged to the budget and written to the log as web_search", async () =>
  {
    const { tool } = searchWith([jsonResponse(200, { results: [profile], costDollars: { total: 0.007 } })]);
    const ai = new ScriptedAi(
      [
        { role: "assistant", content: "", tool_calls: [toolCall("c1", "web_search", { query: "Linear engineering manager" })] },
        { role: "assistant", content: "Sam Rivera." },
      ]);
    const log = new MemoryLog();
    const budget = new RunBudget(0.1);
    const agent = new Agent({ ai, toolbox: new Toolbox([tool]), log, maxSteps: 3, budget });

    assert.equal(await agent.run({ system: "s", task: "t" }), "Sam Rivera.");
    assert.deepEqual(log.usage[1], { tool: "web_search", cost: 0.007 });
    // Two replies at $0.0012 each, plus the search.
    assert.equal(budget.spent.toFixed(4), "0.0094");
    assert.equal(budget.spent, log.usage.reduce((total, entry) => total + entry.cost, 0));
  });

test("searches that use up the budget stop the run before its next trip to the model", async () =>
  {
    const { tool } = searchWith([jsonResponse(200, { results: [], costDollars: { total: 0.05 } }), jsonResponse(200, { results: [], costDollars: { total: 0.05 } })]);
    const ai = new ScriptedAi(
      [
        { role: "assistant", content: "", tool_calls: [toolCall("c1", "web_search", { query: "a" }), toolCall("c2", "web_search", { query: "b" })] },
        { role: "assistant", content: "Should never be asked." },
      ]);
    const agent = new Agent({ ai, toolbox: new Toolbox([tool]), log: new MemoryLog(), maxSteps: 3, budget: new RunBudget(0.1) });

    await assert.rejects(agent.run({ system: "s", task: "t" }), /This run used its \$0\.10 budget/);
    assert.equal(ai.calls.length, 1);
  });

test("the run's log sends a search's cost to the store as a usage entry, which is what the daily cap adds up", async () =>
  {
    const saved = [];
    const store = { addUsage: async (id, entry) => saved.push({ id, entry }) };
    await new RunLog({ store, runId: "run-1" }).addToolCost("web_search", 0.007);
    assert.deepEqual(saved, [{ id: "run-1", entry: { tool: "web_search", cost: 0.007 } }]);
  });
