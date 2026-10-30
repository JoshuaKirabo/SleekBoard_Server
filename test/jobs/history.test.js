import { test } from "node:test";
import assert from "node:assert/strict";
import { LaneHistory } from "../../src/services/jobs/LaneHistory.js";
import { MemoryJobs } from "../fakes.js";

// JobNavigator's record_transition and revert_transition rules: every move is written down, and Undo takes the last
// one back off so it never happened.

const setup = (job = { _id: "job-1", status: "applied" }) =>
  {
    const Job = new MemoryJobs([job]);
    return { Job, history: new LaneHistory({ Job }) };
  };

test("a move changes the lane and writes it down", async () =>
  {
    const { Job, history } = setup();
    const moved = await history.move(await Job.findById("job-1"), "interviewing", "board");
    assert.equal(moved.status, "interviewing");
    assert.equal(moved.moves.length, 1);
    assert.deepEqual({ ...moved.moves[0], at: null }, { from: "applied", to: "interviewing", at: null, source: "board" });
  });

test("moving to the lane it's already in writes nothing", async () =>
  {
    const { Job, history } = setup();
    await history.move(await Job.findById("job-1"), "applied", "board");
    assert.equal((await Job.findById("job-1")).moves.length, 0);
  });

test("a move saves extra fields in the same write and clears a stale suggestion", async () =>
  {
    const { Job, history } = setup({ _id: "job-1", status: "applied", replySuggestion: { to: "interviewing", confidence: 60 } });
    const moved = await history.move(await Job.findById("job-1"), "rejected", "email", { replySnippet: "Unfortunately…" });
    assert.equal(moved.replySnippet, "Unfortunately…");
    assert.equal(moved.replySuggestion, null);
  });

test("a move doesn't land if the card moved since it was read", async () =>
  {
    const { Job, history } = setup();
    const read = await Job.findById("job-1");
    Job.sneak("job-1", "ghosted");
    assert.equal(await history.move(read, "interviewing", "email"), null);
    assert.equal((await Job.findById("job-1")).status, "ghosted");
  });

test("undo puts the card back and leaves no trace", async () =>
  {
    const { Job, history } = setup();
    await history.move(await Job.findById("job-1"), "interviewing", "board");
    const back = await history.undo(await Job.findById("job-1"), "applied");
    assert.equal(back.status, "applied");
    assert.equal(back.moves.length, 0);
  });

test("undo of an email move works the same", async () =>
  {
    const { Job, history } = setup();
    await history.move(await Job.findById("job-1"), "rejected", "email");
    const back = await history.undo(await Job.findById("job-1"), "applied");
    assert.equal(back.status, "applied");
    assert.equal(back.moves.length, 0);
  });

test("an undo that doesn't match the last move is a normal move instead", async () =>
  {
    const { Job, history } = setup();
    await history.move(await Job.findById("job-1"), "interviewing", "board");
    const moved = await history.undo(await Job.findById("job-1"), "offer");
    assert.equal(moved.status, "offer");
    assert.equal(moved.moves.length, 2);
    assert.equal(moved.moves[1].source, "board");
  });

test("an undo with no history is a normal move", async () =>
  {
    const { Job, history } = setup();
    const moved = await history.undo(await Job.findById("job-1"), "saved");
    assert.equal(moved.status, "saved");
    assert.equal(moved.moves.length, 1);
  });

test("an undo doesn't land if the card moved since it was read", async () =>
  {
    const { Job, history } = setup();
    await history.move(await Job.findById("job-1"), "interviewing", "board");
    const read = await Job.findById("job-1");
    await history.move(await Job.findById("job-1"), "offer", "board");
    assert.equal(await history.undo(read, "applied"), null);
    assert.equal((await Job.findById("job-1")).status, "offer");
  });
