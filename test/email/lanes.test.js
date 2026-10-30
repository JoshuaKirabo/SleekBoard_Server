import { test } from "node:test";
import assert from "node:assert/strict";
import { LaneMove } from "../../src/services/email/LaneMove.js";

// Cards only move forward. Ghosted is watched like Applied.

const lanes = new LaneMove();

test("a positive email moves Applied and Ghosted to Interviewing", () =>
  {
    assert.equal(lanes.afterPhrases("applied", "positive"), "interviewing");
    assert.equal(lanes.afterPhrases("ghosted", "positive"), "interviewing");
  });

test("a positive email leaves an Interviewing card where it is", () =>
  {
    assert.equal(lanes.afterPhrases("interviewing", "positive"), null);
  });

test("a rejection ends any waiting card", () =>
  {
    for(const lane of ["applied", "interviewing", "ghosted"]) assert.equal(lanes.afterPhrases(lane, "rejection"), "rejected");
  });

test("cards that aren't waiting never move", () =>
  {
    for(const lane of ["saved", "offer", "rejected"])
      {
        assert.equal(lanes.afterPhrases(lane, "rejection"), null, lane);
        assert.equal(lanes.afterAi(lane, "offer"), null, lane);
      }
  });

test("auto-replies and ambiguous emails move nothing", () =>
  {
    assert.equal(lanes.afterPhrases("applied", "auto_reply"), null);
    assert.equal(lanes.afterPhrases("applied", "ambiguous"), null);
  });

test("the AI can move a card forward", () =>
  {
    assert.equal(lanes.afterAi("applied", "interview"), "interviewing");
    assert.equal(lanes.afterAi("ghosted", "interview"), "interviewing");
    assert.equal(lanes.afterAi("interviewing", "offer"), "offer");
    assert.equal(lanes.afterAi("interviewing", "rejected"), "rejected");
  });

test("the AI can't move a card back or sideways", () =>
  {
    assert.equal(lanes.afterAi("interviewing", "interview"), null);
    assert.equal(lanes.afterAi("applied", "no_change"), null);
    assert.equal(lanes.afterAi("applied", "made_up"), null);
  });
