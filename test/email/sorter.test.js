import { test } from "node:test";
import assert from "node:assert/strict";
import { ReplySorter } from "../../src/services/email/ReplySorter.js";

// The first eleven cases are JobNavigator's own (backend/tests/test_response_parser.py), so our port has to give the
// same answers theirs does.

const sorter = new ReplySorter();

test("an interview invite is positive", () =>
  {
    const result = sorter.sort("Interview invitation for Senior PM", "We'd like to invite you to a phone interview next week.");
    assert.equal(result.kind, "positive");
    assert.ok(result.confidence > 0.5);
  });

test("a rejection is a rejection", () =>
  {
    const result = sorter.sort("Regarding your application", "Unfortunately, we will not be moving forward with your candidacy at this time.");
    assert.equal(result.kind, "rejection");
    assert.ok(result.confidence > 0.5);
  });

test("a thanks for applying is an auto-reply", () =>
  {
    const result = sorter.sort("Application received", "Thank you for applying. We have received your application.");
    assert.equal(result.kind, "auto_reply");
    assert.ok(result.confidence > 0.5);
  });

test("a rejection beats an auto-reply subject", () =>
  {
    assert.equal(sorter.sort("Application received", "Unfortunately, we are not moving forward with your candidacy.").kind, "rejection");
  });

test("a yes and a no together is ambiguous", () =>
  {
    const result = sorter.sort("Next steps", "We would like to invite you. Unfortunately, the position has been filled.");
    assert.equal(result.kind, "ambiguous");
    assert.ok(result.confidence < 0.5);
  });

test("no signal at all is ambiguous", () =>
  {
    const result = sorter.sort("Question", "Hey do you have a minute to chat?");
    assert.equal(result.kind, "ambiguous");
    assert.ok(result.confidence < 0.5);
  });

test("an empty email is ambiguous", () =>
  {
    const result = sorter.sort("", "");
    assert.equal(result.kind, "ambiguous");
    assert.ok(result.confidence < 0.5);
  });

test("more yes phrases mean more confidence, capped at 0.95", () =>
  {
    const one = sorter.sort("Hello", "We would like to invite you.");
    const many = sorter.sort("Next steps", "We would like to invite you to schedule an interview. Please share your availability for a call. We are excited to meet with you.");
    assert.equal(one.kind, "positive");
    assert.equal(many.kind, "positive");
    assert.ok(many.confidence >= one.confidence);
    assert.ok(many.confidence <= 0.95);
  });

test("a thanks for applying with friendly filler stays an auto-reply", () =>
  {
    const body = "Thanks for applying! We're excited to review your background and will connect with you about next steps if there is a match.";
    assert.equal(sorter.sort("Thanks for applying to Amazon", body).kind, "auto_reply");
  });

test("a real invite that opens with thank you for applying stays positive", () =>
  {
    const body = "Thank you for applying. We'd like to schedule a call to discuss the role. Please share your availability for next week.";
    assert.equal(sorter.sort("Interview scheduling — PM role", body).kind, "positive");
  });

test("both ways of saying thanks for applying are auto-replies", () =>
  {
    for(const body of ["Thanks for applying to the Product Manager role.", "Thanks for your application. Our team will review it shortly."])
      {
        assert.equal(sorter.sort("Application", body).kind, "auto_reply", body);
      }
  });

// Ours, for the 0.8 line the check uses.

test("two phrases are sure enough to act, one isn't", () =>
  {
    assert.equal(sorter.sure(sorter.sort("Update", "Unfortunately, we have decided to go with another candidate.")), true);
    assert.equal(sorter.sure(sorter.sort("Update", "Unfortunately, the role is on hold.")), false);
    assert.equal(sorter.sure(sorter.sort("Interview", "Can we schedule an interview? Send your availability for Tuesday.")), true);
  });

test("an auto-reply or an ambiguous email is never sure", () =>
  {
    assert.equal(sorter.sure(sorter.sort("Application received", "Thank you for applying.")), false);
    assert.equal(sorter.sure(sorter.sort("Next steps", "We would like to invite you. Unfortunately, the position has been filled.")), false);
  });
