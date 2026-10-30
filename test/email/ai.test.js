import { test } from "node:test";
import assert from "node:assert/strict";
import { ReplyAi } from "../../src/services/email/ReplyAi.js";
import { ReplyMatch } from "../../src/services/email/ReplyMatch.js";
import { RunBudget } from "../../src/agent/RunBudget.js";
import { ScriptedAi, MemoryLog, cheapModel } from "../fakes.js";

// The AI's answers come from a script, so nothing here talks to Together.

const kpler = { company: "Kpler", role: "Data Analyst", status: "applied", applied: "2026-10-01" };
const amazon = { company: "Amazon", role: "Product Manager", status: "interviewing", applied: "" };
const jobs = [kpler, amazon];

const fromAmazon = { from: "Amazon.jobs <no-reply@amazon.com>", subject: "Following up", body: "Hi Josh, the team would love to connect about next steps." };

// A reader whose model answers with this reply.
const aiWith = (reply) =>
  {
    const ai = new ScriptedAi([{ role: "assistant", content: reply }]);
    return { ai, reader: new ReplyAi({ clientFor: () => ai, match: new ReplyMatch() }) };
  };

const answer = (fields) => JSON.stringify({ match_index: null, status: "no_change", confidence: 0, summary: "", ...fields });

test("the AI gets their prompt, with the waiting jobs numbered and no tools", async () =>
  {
    const { ai, reader } = aiWith(answer({}));
    await reader.read(fromAmazon, jobs);
    const [system, user] = ai.calls[0].messages;
    assert.equal(system.content, "You classify recruiter emails and match them to job applications. Return only valid JSON.");
    assert.match(user.content, /Active applications:\n1\. Kpler — Data Analyst \(applied since 2026-10-01\)\n2\. Amazon — Product Manager \(interviewing since unknown\)/);
    assert.match(user.content, /From: Amazon\.jobs <no-reply@amazon\.com>\nSubject: Following up\nBody:\nHi Josh/);
    assert.equal(ai.calls[0].tools.length, 0);
  });

test("only the first 1,500 characters of the body go to the AI", async () =>
  {
    const { ai, reader } = aiWith(answer({}));
    await reader.read({ ...fromAmazon, body: "a".repeat(1_500) + "SECRET" }, jobs);
    assert.ok(!ai.calls[0].messages[1].content.includes("SECRET"));
  });

test("dollar signs in an email don't break the prompt", async () =>
  {
    const { ai, reader } = aiWith(answer({}));
    await reader.read({ ...fromAmazon, body: "Base pay $$ and $& bonus" }, jobs);
    assert.match(ai.calls[0].messages[1].content, /Base pay \$\$ and \$& bonus/);
  });

test("an email that types a blank's name doesn't get another field pasted in", async () =>
  {
    const { ai, reader } = aiWith(answer({}));
    await reader.read({ ...fromAmazon, subject: "Re: {body}", body: "the real body" }, jobs);
    const prompt = ai.calls[0].messages[1].content;
    assert.match(prompt, /Subject: Re: \{body\}\nBody:\nthe real body/);
  });

test("no waiting jobs says so", async () =>
  {
    const { ai, reader } = aiWith(answer({}));
    await reader.read(fromAmazon, []);
    assert.match(ai.calls[0].messages[1].content, /Active applications:\n\(no active applications\)/);
  });

test("an answer picks the job by its number", async () =>
  {
    const { reader } = aiWith(answer({ match_index: 2, status: "interview", confidence: 85, summary: "Wants to set up a call." }));
    assert.deepEqual(await reader.read(fromAmazon, jobs), { job: amazon, status: "interview", confidence: 85, summary: "Wants to set up a call." });
  });

test("an answer wrapped in a code fence or chatter still reads", async () =>
  {
    const fenced = "```json\n" + answer({ match_index: 1, status: "rejected", confidence: 90 }) + "\n```";
    assert.equal((await aiWith(fenced).reader.read(fromAmazon, jobs)).job, kpler);
    const chatty = "Sure! Here it is: " + answer({ match_index: 1, status: "rejected", confidence: 90 }) + " Hope that helps.";
    assert.equal((await aiWith(chatty).reader.read(fromAmazon, jobs)).status, "rejected");
  });

test("a made-up status becomes no_change", async () =>
  {
    const { reader } = aiWith(answer({ match_index: 1, status: "hired", confidence: 99 }));
    assert.equal((await reader.read(fromAmazon, jobs)).status, "no_change");
  });

test("a number off the list means no job", async () =>
  {
    for(const match_index of [0, 3, -1, 1.5, "1"])
      {
        const { reader } = aiWith(answer({ match_index, status: "interview", confidence: 90 }));
        assert.equal((await reader.read(fromAmazon, jobs)).job, null, String(match_index));
      }
  });

test("no usable confidence, or no JSON at all, throws the answer away", async () =>
  {
    assert.equal(await aiWith(answer({ confidence: "high" })).reader.read(fromAmazon, jobs), null);
    assert.equal(await aiWith(JSON.stringify({ status: "interview" })).reader.read(fromAmazon, jobs), null);
    assert.equal(await aiWith("I think it's an interview.").reader.read(fromAmazon, jobs), null);
    assert.equal(await aiWith("").reader.read(fromAmazon, jobs), null);
  });

test("the read is billed to the budget and the log", async () =>
  {
    const { reader } = aiWith(answer({}));
    const log = new MemoryLog();
    const budget = new RunBudget(0.1);
    await reader.read(fromAmazon, jobs, { log, budget });
    assert.equal(budget.spent, cheapModel.costOf({ input: 1000, output: 100 }));
    assert.equal(log.usage.length, 1);
  });

test("a sure answer on the sender's company moves the card", () =>
  {
    const reader = aiWith("").reader;
    assert.equal(reader.acts({ job: amazon, status: "interview", confidence: 70, summary: "" }, fromAmazon), true);
  });

test("under 70, no_change, or no job moves nothing", () =>
  {
    const reader = aiWith("").reader;
    assert.equal(reader.acts({ job: amazon, status: "interview", confidence: 69, summary: "" }, fromAmazon), false);
    assert.equal(reader.acts({ job: amazon, status: "no_change", confidence: 95, summary: "" }, fromAmazon), false);
    assert.equal(reader.acts({ job: null, status: "interview", confidence: 95, summary: "" }, fromAmazon), false);
    assert.equal(reader.acts(null, fromAmazon), false);
  });

test("the AI can't put an Amazon email on a Kpler card, however sure it is", () =>
  {
    const reader = aiWith("").reader;
    assert.equal(reader.acts({ job: kpler, status: "rejected", confidence: 100, summary: "" }, fromAmazon), false);
  });
