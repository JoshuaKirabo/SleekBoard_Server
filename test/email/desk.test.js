import { test } from "node:test";
import assert from "node:assert/strict";
import { ReplyDesk } from "../../src/services/email/ReplyDesk.js";
import { LaneMove } from "../../src/services/email/LaneMove.js";
import { LaneHistory } from "../../src/services/jobs/LaneHistory.js";
import { MemoryJobs } from "../fakes.js";

const setup = (job = { _id: "job-1", company: "Stripe", status: "applied" }) =>
  {
    const Job = new MemoryJobs([job]);
    return { Job, desk: new ReplyDesk({ Job, history: new LaneHistory({ Job }), lanes: new LaneMove() }) };
  };

const reply = { from: "Stripe <no-reply@stripe.com>", subject: "Interview", body: "  Hi Josh,\n\n  We'd like to schedule an interview.  " };
const status = async (promise) => (await promise.then(() => null, (error) => error)).status;

test("the snippet is the body's first 200 characters on one line", () =>
  {
    const { desk } = setup();
    assert.equal(desk.snippetOf(reply), "Hi Josh, We'd like to schedule an interview.");
    assert.equal(desk.snippetOf({ ...reply, body: "x".repeat(300) }).length, 200);
  });

test("an empty body falls back to the subject", () =>
  {
    const { desk } = setup();
    assert.equal(desk.snippetOf({ ...reply, body: "   " }), "Interview");
  });

test("a move is an email move and keeps the reply", async () =>
  {
    const { Job, desk } = setup();
    const moved = await desk.move(await Job.findById("job-1"), "interviewing", reply);
    assert.equal(moved.status, "interviewing");
    assert.equal(moved.moves[0].source, "email");
    assert.equal(moved.replySnippet, "Hi Josh, We'd like to schedule an interview.");
    assert.ok(moved.replyAt instanceof Date);
  });

test("a note keeps the reply without moving the card", async () =>
  {
    const { Job, desk } = setup({ _id: "job-1", company: "Stripe", status: "interviewing" });
    const noted = await desk.note(await Job.findById("job-1"), reply);
    assert.equal(noted.status, "interviewing");
    assert.equal(noted.moves.length, 0);
    assert.equal(noted.replySnippet, "Hi Josh, We'd like to schedule an interview.");
  });

test("a suggestion waits on the card and moves nothing", async () =>
  {
    const { Job, desk } = setup();
    const suggested = await desk.suggest(await Job.findById("job-1"), "interviewing", 55, reply);
    assert.equal(suggested.status, "applied");
    assert.equal(suggested.replySuggestion.to, "interviewing");
    assert.equal(suggested.replySuggestion.confidence, 55);
  });

test("accepting a suggestion moves the card as an email move and clears it", async () =>
  {
    const { Job, desk } = setup();
    await desk.suggest(await Job.findById("job-1"), "interviewing", 55, reply);
    const moved = await desk.decide("job-1", "accept");
    assert.equal(moved.status, "interviewing");
    assert.equal(moved.moves[0].source, "email");
    assert.equal(moved.replySuggestion, null);
  });

test("dismissing a suggestion clears it and leaves the card", async () =>
  {
    const { Job, desk } = setup();
    await desk.suggest(await Job.findById("job-1"), "interviewing", 55, reply);
    const left = await desk.decide("job-1", "dismiss");
    assert.equal(left.status, "applied");
    assert.equal(left.replySuggestion, null);
  });

test("a suggestion the card has moved past is cleared, not followed", async () =>
  {
    const { Job, desk } = setup();
    await desk.suggest(await Job.findById("job-1"), "interviewing", 55, reply);
    Job.sneak("job-1", "offer");
    assert.equal(await status(desk.decide("job-1", "accept")), 409);
    const job = await Job.findById("job-1");
    assert.equal(job.status, "offer");
    assert.equal(job.replySuggestion, null);
  });

test("bad answers are turned away with the right status", async () =>
  {
    const { desk } = setup();
    assert.equal(await status(desk.decide("job-1", "maybe")), 400);
    assert.equal(await status(desk.decide("nope", "accept")), 404);
    assert.equal(await status(desk.decide("job-1", "accept")), 409);
  });
