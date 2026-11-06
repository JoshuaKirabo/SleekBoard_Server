import { test } from "node:test";
import assert from "node:assert/strict";
import { JobFields } from "../../src/services/jobs/JobFields.js";

// The checks Mongoose's job model used to make, now made before anything reaches Postgres.

const fields = new JobFields();
const status = (work) =>
  {
    try
      {
        work();
        return 200;
      }
    catch(error)
      {
        return error.status;
      }
  };
const messageOf = (work) =>
  {
    try
      {
        work();
        return "";
      }
    catch(error)
      {
        return error.message;
      }
  };

test("a new job needs a company and a role", () =>
  {
    assert.equal(messageOf(() => fields.forCreate({ role: "PM" })), "Company is required.");
    assert.equal(messageOf(() => fields.forCreate({ company: "Stripe", role: "   " })), "Role is required.");
    assert.deepEqual(fields.forCreate({ company: " Stripe ", role: "PM" }), { company: "Stripe", role: "PM" });
  });

test("only the editable fields come through", () =>
  {
    const clean = fields.forCreate({ company: "Stripe", role: "PM", id: "mine", userId: "someone-else", moves: [{ to: "offer" }], createdAt: "2020-01-01" });
    assert.deepEqual(Object.keys(clean).sort(), ["company", "role"]);
  });

test("an update only checks what was sent, but can't blank a required field", () =>
  {
    assert.deepEqual(fields.forUpdate({ notes: "Call Tuesday" }), { notes: "Call Tuesday" });
    assert.equal(messageOf(() => fields.forUpdate({ company: "" })), "Company is required.");
  });

test("lanes have to be one of the six", () =>
  {
    assert.equal(fields.forUpdate({ status: "offer" }).status, "offer");
    assert.equal(messageOf(() => fields.forUpdate({ status: "hired" })), "hired isn't a lane.");
  });

test("dates are YYYY-MM-DD and have to exist", () =>
  {
    assert.equal(fields.forUpdate({ applied: "" }).applied, "");
    assert.equal(fields.forUpdate({ applied: "2028-02-29" }).applied, "2028-02-29");
    assert.equal(messageOf(() => fields.forUpdate({ applied: "2026-02-30" })), "2026-02-30 isn't a real date.");
    assert.equal(messageOf(() => fields.forUpdate({ deadline: "31/10/2026" })), "Dates look like 2026-10-31.");
  });

test("nothing goes past its column", () =>
  {
    assert.equal(messageOf(() => fields.forUpdate({ company: "x".repeat(121) })), "company can be at most 120 characters.");
    assert.equal(fields.forUpdate({ logo: "x".repeat(200000) }).logo.length, 200000);
    assert.equal(status(() => fields.forUpdate({ logo: "x".repeat(200001) })), 400);
  });

test("numbers become text, objects are refused", () =>
  {
    assert.equal(fields.forUpdate({ notes: 42 }).notes, "42");
    assert.equal(messageOf(() => fields.forUpdate({ notes: { $gt: "" } })), "notes should be a string.");
    assert.equal(messageOf(() => fields.forUpdate({ link: ["a"] })), "link should be a string.");
  });

test("every refusal is a 400", () =>
  {
    assert.equal(status(() => fields.forCreate({})), 400);
    assert.equal(status(() => fields.forUpdate({ status: "nope" })), 400);
  });
