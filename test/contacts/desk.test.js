import { test } from "node:test";
import assert from "node:assert/strict";
import { SuggestionDesk } from "../../src/services/contacts/SuggestionDesk.js";

const sam = { name: "Sam Rivera", title: "Technical Recruiter", type: "recruiter", location: "unknown", link: "https://linkedin.com/in/samrivera", quote: "Technical Recruiter at Apple", reason: "Recruits for iOS." };

// A desk over stand-ins that remember what was asked of them.
const deskWith = (run) =>
  {
    const saved = [];
    const decided = [];
    const runs =
      {
        find: async (id) => (id === run?.id ? run : null),
        decide: async (id, index, decision) => decided.push({ id, index, decision }),
      };
    const jobs = { findById: async (id) => (id === "job-1" ? { _id: "job-1", company: "Apple" } : null) };
    const book = { save: async (fields, jobId) => (saved.push({ fields, jobId }), { id: "contact-1", ...fields }) };
    const card = { fill: async (jobId) => ({ id: jobId, contact: "Sam Rivera" }) };
    return { desk: new SuggestionDesk({ runs, jobs, book, card }), saved, decided };
  };

const doneRun = (contacts = [sam]) => ({ id: "run-1", kind: "contact", status: "done", job: "job-1", result: { contacts, note: "" } });

test("accepting copies the person from the run, under the job's company", async () =>
  {
    const { desk, saved, decided } = deskWith(doneRun());
    const answer = await desk.decide("run-1", 0, "accept");
    assert.deepEqual(saved, [{ fields: { name: "Sam Rivera", company: "Apple", type: "recruiter", title: "Technical Recruiter", location: "", link: sam.link, quote: sam.quote, reason: sam.reason, source: "run" }, jobId: "job-1" }]);
    assert.deepEqual(decided, [{ id: "run-1", index: 0, decision: "accept" }]);
    assert.equal(answer.contact.name, "Sam Rivera");
    assert.equal(answer.job.contact, "Sam Rivera");
  });

test("rejecting saves nobody but still answers the suggestion", async () =>
  {
    const { desk, saved, decided } = deskWith(doneRun());
    const answer = await desk.decide("run-1", 0, "reject");
    assert.equal(saved.length, 0);
    assert.equal(answer.contact, null);
    assert.deepEqual(decided, [{ id: "run-1", index: 0, decision: "reject" }]);
  });

test("bad answers are turned away with the right status", async () =>
  {
    const status = async (promise) => (await promise.then(() => null, (error) => error)).status;
    assert.equal(await status(deskWith(doneRun()).desk.decide("run-1", 0, "maybe")), 400);
    assert.equal(await status(deskWith(doneRun()).desk.decide("nope", 0, "accept")), 404);
    assert.equal(await status(deskWith(doneRun()).desk.decide("run-1", 3, "accept")), 404);
    assert.equal(await status(deskWith(doneRun()).desk.decide("run-1", NaN, "accept")), 404);
    assert.equal(await status(deskWith({ ...doneRun(), status: "running" }).desk.decide("run-1", 0, "accept")), 409);
    assert.equal(await status(deskWith({ ...doneRun(), kind: "note" }).desk.decide("run-1", 0, "accept")), 409);
    assert.equal(await status(deskWith(doneRun([{ ...sam, decision: "reject" }])).desk.decide("run-1", 0, "accept")), 409);
  });
