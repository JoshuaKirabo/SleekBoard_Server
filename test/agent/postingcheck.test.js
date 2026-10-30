import { test } from "node:test";
import assert from "node:assert/strict";
import { PostingCheck } from "../../src/agent/PostingCheck.js";
import { FillTask } from "../../src/agent/tasks/FillTask.js";
import { RunBudget } from "../../src/agent/RunBudget.js";
import { ScriptedAi, MemoryLog, cheapModel } from "../fakes.js";

const TOOL_PAGE = `<h1>System Design Architect</h1><p>${"An MCP skill that helps you design distributed systems. Install it in Claude Code. ".repeat(10)}</p>`;
const JOB_PAGE = `<h1>Software Engineer, New Grad</h1><p>${"Join Stripe's Seattle office. Apply now. Requirements: CS degree. ".repeat(10)}</p>`;

const pageOf = (html) => async () => ({ html, type: "text/html", url: null });
const blocked = async () =>
  {
    throw new Error("403");
  };

// A check whose model answers from a script, so a test can read what it was asked.
const checkWith = (reply, fetchPage = pageOf(TOOL_PAGE)) =>
  {
    const ai = new ScriptedAi([{ role: "assistant", content: reply }]);
    return { ai, check: new PostingCheck({ clientFor: () => ai, fetchPage }) };
  };

test("a page the model calls not a job is refused, with its reason", async () =>
  {
    const { ai, check } = checkWith("not a job: listing for an AI tool, not a job posting.");
    assert.deepEqual(await check.check("https://mcpmarket.com/tools/skills/system-design-architect-3"), { job: false, reason: "listing for an AI tool, not a job posting." });
    assert.match(ai.calls[0].messages[1].content, /The page's text \(the start of it\):\nSystem Design Architect/);
    assert.equal(ai.calls[0].tools.length, 0);
  });

test("a job page is let through", async () =>
  {
    const { check } = checkWith("job", pageOf(JOB_PAGE));
    assert.deepEqual(await check.check("https://stripe.com/jobs/1"), { job: true });
  });

test("a page that can't be read is judged by its link alone", async () =>
  {
    const { ai, check } = checkWith("job", blocked);
    await check.check("https://www.linkedin.com/jobs/view/4123456789");
    assert.match(ai.calls[0].messages[1].content, /judge from the link alone/);
  });

test("only a clear no refuses; a muddled answer lets the run go on", async () =>
  {
    const check = new PostingCheck({ clientFor: null, fetchPage: null });
    assert.deepEqual(check.verdictOf("Not a job."), { job: false, reason: "" });
    assert.deepEqual(check.verdictOf("**Not a job** - a salary page"), { job: false, reason: "a salary page" });
    assert.deepEqual(check.verdictOf("Job"), { job: true });
    assert.deepEqual(check.verdictOf("I think it might be a job? Hard to say."), { job: true });
    assert.deepEqual(check.verdictOf(""), { job: true });
  });

test("the check is billed to the run", async () =>
  {
    const { check } = checkWith("job", pageOf(JOB_PAGE));
    const log = new MemoryLog();
    const budget = new RunBudget(0.1);
    await check.check("https://stripe.com/jobs/1", { log, budget });
    assert.equal(log.usage.length, 1);
    assert.equal(log.usage[0].model, cheapModel.id);
    assert.equal(budget.spent, cheapModel.costOf({ input: 1000, output: 100 }));
  });

const fillTaskWith = ({ read, verdict }) =>
  {
    const asked = [];
    const check = { check: async (link) => (asked.push(link), verdict) };
    const task = new FillTask({ readJob: async () => read, check, exa: null, fetchPage: null, store: { showResult: async () => {} } });
    return { task, asked };
  };

test("Fill in stops at the check when the link isn't a job", async () =>
  {
    const { task } = fillTaskWith({ read: { source: "url" }, verdict: { job: false, reason: "listing for an AI tool." } });
    const log = new MemoryLog();
    await assert.rejects(task.start({ id: "run-1", input: { link: "https://mcpmarket.com/tools/skills/system-design-architect-3" } }, { log }), /^Error: Not a job: listing for an AI tool\.$/);
    assert.deepEqual(log.steps, [{ type: "message", text: "Checked the link: listing for an AI tool." }]);
  });

test("Fill in goes on after a yes, and skips the check when the page has job data", async () =>
  {
    const yes = fillTaskWith({ read: null, verdict: { job: true } });
    assert.ok(await yes.task.start({ id: "run-1", input: { link: "https://example.com/careers/123" } }, {}));
    assert.deepEqual(yes.asked, ["https://example.com/careers/123"]);

    const facts = fillTaskWith({ read: { source: "jobposting", company: "Intel", role: "SDE" }, verdict: { job: false } });
    assert.ok(await facts.task.start({ id: "run-1", input: { link: "https://intel.wd1.myworkdayjobs.com/job/1" } }, {}));
    assert.deepEqual(facts.asked, []);
  });
