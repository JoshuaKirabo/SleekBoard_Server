import { test } from "node:test";
import assert from "node:assert/strict";
import { ReplyCheck } from "../../src/services/email/ReplyCheck.js";
import { ReplySorter } from "../../src/services/email/ReplySorter.js";
import { ReplyMatch } from "../../src/services/email/ReplyMatch.js";
import { ReplyAi } from "../../src/services/email/ReplyAi.js";
import { ReplyDesk } from "../../src/services/email/ReplyDesk.js";
import { LaneMove } from "../../src/services/email/LaneMove.js";
import { GmailSearch } from "../../src/services/email/GmailSearch.js";
import { LaneHistory } from "../../src/services/jobs/LaneHistory.js";
import { MemoryJobs, MemoryLog, ScriptedAi } from "../fakes.js";

// The whole check with a stand-in Gmail and mailbox. The sorting, matching, lanes and desk are the real ones, and the
// AI answers from a script.

const CARDS =
  [
    { _id: "stripe", company: "Stripe", role: "SWE", status: "applied" },
    { _id: "kpler", company: "Kpler", role: "Data Analyst", status: "ghosted" },
    { _id: "datadog", company: "Datadog", role: "SWE Intern", status: "interviewing" },
    { _id: "figma", company: "Figma", role: "Designer", status: "saved" },
  ];

const mail =
  {
    stripeNo: { from: "Stripe <no-reply@stripe.com>", subject: "Your application", body: "Unfortunately, we have decided to go with other candidates." },
    kplerYes: { from: "Kpler Talent <no-reply@greenhouse-mail.io>", subject: "Interview", body: "We'd like to schedule an interview. Please send your availability for next week." },
    datadogYes: { from: "Datadog <talent@datadoghq.com>", subject: "Next round", body: "We would like to schedule a call with the team. Share your availability for Thursday." },
    thanks: { from: "Stripe <no-reply@stripe.com>", subject: "Application received", body: "Thank you for applying to Stripe." },
    nobodyNo: { from: "Acme <jobs@acme.com>", subject: "Update", body: "Unfortunately we decided to go with other candidates." },
    stripeVague: { from: "Stripe Recruiting <no-reply@stripe.com>", subject: "Following up", body: "Hi Josh, the team would love to connect about next steps." },
    figmaYes: { from: "Figma <jobs@figma.com>", subject: "Interview", body: "We'd like to schedule an interview. Your availability?" },
  };

const answer = (fields) => ({ role: "assistant", content: JSON.stringify({ match_index: null, status: "no_change", confidence: 0, summary: "", ...fields }) });

const setup = ({ inbox, processed = [], caughtUp = false, ai = [], fail = [], cards = CARDS } = {}) =>
  {
    const Job = new MemoryJobs(cards);
    const clock = { now: 1_000_000_000 };
    const box = { processed: [...processed], resting: [], caughtUp, checks: [] };
    const queries = [];
    const gmail =
      {
        ids: async (token, query) => (queries.push(query), Object.keys(inbox)),
        message: async (token, id) =>
          {
            if(fail.includes(id)) throw new Error("Gmail hiccup");
            return { id, ...inbox[id] };
          },
      };
    const mailbox =
      {
        get: async () => structuredClone(box),
        remember: async (id) =>
          {
            box.processed.push(id);
            box.resting = box.resting.filter((one) => one.id !== id);
          },
        leave: async (id) => box.resting = [...box.resting.filter((one) => one.id !== id), { id, at: new Date(clock.now) }],
        checked: async (clean) => (box.checks.push(clean), clean && (box.caughtUp = true)),
      };
    const lanes = new LaneMove();
    const match = new ReplyMatch();
    const model = new ScriptedAi(ai);
    const gaps = [];
    const check = new ReplyCheck(
      {
        gmail,
        search: new GmailSearch(),
        reader: { read: (message) => message },
        mailbox,
        jobs: Job,
        sorter: new ReplySorter(),
        match,
        ai: new ReplyAi({ clientFor: () => model, match }),
        lanes,
        desk: new ReplyDesk({ Job, history: new LaneHistory({ Job }), lanes }),
        sleep: async (ms) => gaps.push(ms),
        now: () => clock.now,
      });
    const log = new MemoryLog();
    return { check, Job, box, clock, queries, model, gaps, log, go: () => check.run({ token: "tok", log }) };
  };

test("sure replies move their cards, as email moves, with the reply kept", async () =>
  {
    const { Job, box, log, go } = setup({ inbox: { m1: mail.stripeNo, m2: mail.kplerYes } });
    const result = await go();
    assert.equal(result.moved, 2);
    assert.equal((await Job.findById("stripe")).status, "rejected");
    const kpler = await Job.findById("kpler");
    assert.equal(kpler.status, "interviewing");
    assert.equal(kpler.moves[0].source, "email");
    assert.match(kpler.replySnippet, /schedule an interview/);
    assert.deepEqual(box.processed, ["m1", "m2"]);
    assert.ok(log.steps.some((step) => step.text === "Moved Stripe to Rejected from a reply."));
    assert.equal(log.steps.at(-1).text, "Checked 90 days of replies: 2 found, 2 moved.");
  });

test("a positive reply on a card already in Interviewing is kept, not moved", async () =>
  {
    const { Job, go } = setup({ inbox: { m1: mail.datadogYes } });
    assert.equal((await go()).noted, 1);
    const datadog = await Job.findById("datadog");
    assert.equal(datadog.status, "interviewing");
    assert.match(datadog.replySnippet, /schedule a call/);
  });

test("an auto-reply is handled and moves nothing", async () =>
  {
    const { Job, box, go } = setup({ inbox: { m1: mail.thanks } });
    assert.equal((await go()).ignored, 1);
    assert.equal((await Job.findById("stripe")).status, "applied");
    assert.deepEqual(box.processed, ["m1"]);
  });

test("a sure reply with no card rests, then lands once the card exists", async () =>
  {
    const { Job, box, clock, go } = setup({ inbox: { m1: mail.nobodyNo } });
    assert.equal((await go()).left, 1);
    assert.deepEqual(box.processed, []);
    assert.deepEqual(box.resting.map((one) => one.id), ["m1"]);
    Job.jobs.set("acme", { _id: "acme", company: "Acme", role: "PM", status: "applied", moves: [], replySuggestion: null });
    assert.equal((await go()).resting, 1);
    clock.now += 10 * 60_000 + 1;
    assert.equal((await go()).moved, 1);
    assert.equal((await Job.findById("acme")).status, "rejected");
    assert.deepEqual(box.resting, []);
    assert.deepEqual(box.processed, ["m1"]);
  });

test("a reply with no card doesn't hold up the first look", async () =>
  {
    const { box, go } = setup({ inbox: { m1: mail.nobodyNo } });
    await go();
    assert.deepEqual(box.checks, [true]);
  });

test("a Saved card isn't waiting on a reply, so it's left alone", async () =>
  {
    const { Job, go } = setup({ inbox: { m1: mail.figmaYes } });
    assert.equal((await go()).left, 1);
    assert.equal((await Job.findById("figma")).status, "saved");
  });

test("replies already handled aren't read again", async () =>
  {
    const { Job, go } = setup({ inbox: { m1: mail.stripeNo }, processed: ["m1"] });
    assert.equal((await go()).found, 1);
    assert.equal((await Job.findById("stripe")).status, "applied");
  });

test("the first check reads 90 days, and once it's caught up the next reads 3", async () =>
  {
    const { check, queries, log } = setup({ inbox: { m1: mail.thanks } });
    await check.run({ token: "tok", log });
    await check.run({ token: "tok", log });
    assert.match(queries[0], /newer_than:90d/);
    assert.match(queries[1], /newer_than:3d/);
  });

test("a check that runs out of AI reads stays on the 90-day look", async () =>
  {
    const inbox = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`m${i}`, { ...mail.stripeVague, subject: `Following up ${i}` }]));
    const { check, queries, log } = setup({ inbox, ai: Array.from({ length: 6 }, () => answer({})) });
    await check.run({ token: "tok", log });
    await check.run({ token: "tok", log });
    await check.run({ token: "tok", log });
    assert.match(queries[1], /newer_than:90d/);
    assert.match(queries[2], /newer_than:3d/);
  });

test("an unclear reply the AI is sure about moves the card", async () =>
  {
    const { Job, model, go } = setup({ inbox: { m1: mail.stripeVague }, ai: [answer({ match_index: 1, status: "interview", confidence: 92 })] });
    assert.equal((await go()).moved, 1);
    assert.equal((await Job.findById("stripe")).status, "interviewing");
    assert.match(model.calls[0].messages[1].content, /1\. Stripe — SWE \(applied since unknown\)/);
  });

test("an unclear reply the AI isn't sure about becomes a suggestion", async () =>
  {
    const { Job, log, go } = setup({ inbox: { m1: mail.stripeVague }, ai: [answer({ match_index: 1, status: "interview", confidence: 55 })] });
    assert.equal((await go()).suggested, 1);
    const stripe = await Job.findById("stripe");
    assert.equal(stripe.status, "applied");
    assert.deepEqual({ to: stripe.replySuggestion.to, confidence: stripe.replySuggestion.confidence }, { to: "interviewing", confidence: 55 });
    assert.ok(log.steps.some((step) => step.text === "Suggested moving Stripe to Interviewing."));
  });

test("the AI picking a card the sender doesn't match moves and suggests nothing", async () =>
  {
    const { Job, go } = setup({ inbox: { m1: mail.stripeVague }, ai: [answer({ match_index: 2, status: "rejected", confidence: 99 })] });
    assert.equal((await go()).ignored, 1);
    const kpler = await Job.findById("kpler");
    assert.equal(kpler.status, "ghosted");
    assert.equal(kpler.replySuggestion, null);
  });

test("a suggestion that wouldn't be a step forward is dropped", async () =>
  {
    const { Job, go } = setup({ inbox: { m1: mail.stripeVague }, cards: [{ _id: "stripe", company: "Stripe", role: "SWE", status: "interviewing" }], ai: [answer({ match_index: 1, status: "interview", confidence: 50 })] });
    assert.equal((await go()).ignored, 1);
    assert.equal((await Job.findById("stripe")).replySuggestion, null);
  });

test("a failed AI read rests and is tried again, instead of lost", async () =>
  {
    const { box, go } = setup({ inbox: { m1: mail.stripeVague }, ai: [{ role: "assistant", content: "Looks like an interview!" }] });
    assert.equal((await go()).left, 1);
    assert.deepEqual(box.processed, []);
    assert.deepEqual(box.resting.map((one) => one.id), ["m1"]);
  });

test("the AI reads 5 replies a check at most, 2 seconds apart, and the rest wait", async () =>
  {
    const inbox = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`m${i}`, { ...mail.stripeVague, subject: `Following up ${i}` }]));
    const { model, gaps, box, go } = setup({ inbox, ai: Array.from({ length: 6 }, () => answer({})) });
    const result = await go();
    assert.equal(model.calls.length, 5);
    assert.deepEqual(gaps, [2000, 2000, 2000, 2000]);
    assert.equal(result.ignored, 5);
    assert.equal(result.deferred, 1);
    assert.equal(box.processed.length, 5);
    assert.deepEqual(box.resting, []);
    assert.deepEqual(box.checks, [false]);
  });

test("a message Gmail won't open waits for the next check, without resting", async () =>
  {
    const { box, go } = setup({ inbox: { m1: mail.stripeNo, m2: mail.kplerYes }, fail: ["m1"] });
    const result = await go();
    assert.equal(result.deferred, 1);
    assert.deepEqual(box.resting, []);
    assert.equal(result.moved, 1);
    assert.deepEqual(box.processed, ["m2"]);
  });

test("a card moved by one reply isn't moved again by the next", async () =>
  {
    const second = { ...mail.stripeNo, subject: "Following up on your application" };
    const { Job, go } = setup({ inbox: { m1: mail.stripeNo, m2: second } });
    const result = await go();
    assert.equal(result.moved, 1);
    assert.equal(result.left, 1);
    assert.equal((await Job.findById("stripe")).moves.length, 1);
  });

test("a stopped run stops the check, and what it handled stays handled", async () =>
  {
    const { check, box } = setup({ inbox: { m1: mail.thanks, m2: mail.stripeNo } });
    const stop = new AbortController();
    const remember = check.mailbox.remember;
    check.mailbox.remember = async (id) =>
      {
        await remember(id);
        stop.abort(new Error("This run took too long."));
      };
    await assert.rejects(check.run({ token: "tok", signal: stop.signal }), /took too long/);
    assert.deepEqual(box.processed, ["m1"]);
  });

test("hasNew is true only while a reply is due", async () =>
  {
    const { check, clock, go } = setup({ inbox: { m1: mail.thanks, m2: mail.nobodyNo } });
    assert.equal(await check.hasNew("tok"), true);
    await go();
    assert.equal(await check.hasNew("tok"), false);
    clock.now += 10 * 60_000 + 1;
    assert.equal(await check.hasNew("tok"), true);
  });
