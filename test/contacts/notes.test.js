import { test } from "node:test";
import assert from "node:assert/strict";
import { SaveNotes } from "../../src/agent/tools/SaveNotes.js";
import { NoteTask } from "../../src/agent/tasks/NoteTask.js";
import { Toolbox } from "../../src/agent/Toolbox.js";
import { Agent } from "../../src/agent/Agent.js";
import { Runner } from "../../src/agent/Runner.js";
import { SpendingCap } from "../../src/agent/SpendingCap.js";
import { ScriptedAi, MemoryLog, MemoryRunStore, toolCall } from "../fakes.js";

const DIRECT = "Hi Sam, I'm interested in the iOS Engineer Intern role at Apple in Cupertino. Happy to share my CV if it's a fit.";
const PERSONAL = "Hi Sam, the iOS Foundations team's work on the core frameworks caught my eye. Is the Cupertino intern team still growing?";

test("two good notes are kept, one per style", async () =>
  {
    const tool = new SaveNotes({ applied: false });
    assert.match(await tool.run({ direct: DIRECT, personal: PERSONAL }), /Saved both notes/);
    assert.deepEqual(tool.notes, [{ style: "direct", text: DIRECT }, { style: "personal", text: PERSONAL }]);
  });

test("a note over 200 characters is refused with its length", async () =>
  {
    const tool = new SaveNotes({ applied: false });
    await assert.rejects(tool.run({ direct: "x".repeat(201), personal: PERSONAL }), /direct note is 201 characters/);
    assert.equal(tool.notes, null);
  });

test("spacing is tidied before the length is counted", async () =>
  {
    const tool = new SaveNotes({ applied: false });
    await tool.run({ direct: `  ${DIRECT.replace(/ /g, "   ")}\n`, personal: PERSONAL });
    assert.equal(tool.notes[0].text, DIRECT);
  });

test("a placeholder, a missing note, or two of the same are refused", async () =>
  {
    const tool = new SaveNotes({ applied: false });
    await assert.rejects(tool.run({ direct: "Hi Sam, I bring [your skill] to the iOS role.", personal: PERSONAL }), /placeholder, \[your skill\]/);
    await assert.rejects(tool.run({ direct: DIRECT }), /needs the personal note/);
    await assert.rejects(tool.run({ direct: DIRECT, personal: DIRECT.toUpperCase() }), /two notes are the same/);
  });

test("a note may only say you applied once you have", async () =>
  {
    const claim = "Hi Sam, I've just applied for the iOS Engineer Intern role at Apple. Happy to share my CV.";
    await assert.rejects(new SaveNotes({ applied: false }).run({ direct: claim, personal: PERSONAL }), /says the user applied/);
    const tool = new SaveNotes({ applied: true });
    await tool.run({ direct: claim, personal: PERSONAL });
    assert.equal(tool.notes[0].text, claim);
  });

const appleJob = { _id: "job-1", company: "Apple", role: "iOS Engineer Intern", location: "Cupertino, CA", link: "jobs.apple.com/en-us/details/1", status: "saved" };
const sam = { _id: "contact-1", name: "Sam Rivera", title: "Technical Recruiter", type: "recruiter", source: "run", jobs: ["job-1"] };

const noteTaskWith = ({ job = appleJob, contact = sam, fetchPage = async () => ({ html: "", url: null }) } = {}) =>
  {
    const jobs = { findById: async (id) => (id === "job-1" ? job : null) };
    const contacts = { find: async (id) => (String(id) === "contact-1" ? contact : null) };
    return new NoteTask({ jobs, contacts, fetchPage });
  };

test("a note run needs a contact saved for its job", async () =>
  {
    const task = noteTaskWith();
    await assert.rejects(task.inputFor({}, "job-1"), /Say which contact/);
    await assert.rejects(task.inputFor({ contact: "nobody" }, "job-1"), /doesn't exist/);
    await assert.rejects(task.inputFor({ contact: "contact-1" }, "job-2"), /isn't saved for this job/);
    assert.deepEqual(await task.inputFor({ contact: "contact-1" }, "job-1"), { contact: "contact-1" });
  });

test("the brief gives the job, the person and only the history we know", async () =>
  {
    const cold = (await noteTaskWith().start({ job: "job-1", input: { contact: "contact-1" } })).brief().task;
    assert.match(cold, /Posting: https:\/\/jobs\.apple\.com/);
    assert.match(cold, /Applied: not yet/);
    assert.match(cold, /Who they are: recruiter/);
    assert.match(cold, /haven't been in touch yet/);

    const known = { ...sam, type: "internal_referral", source: "linkedin", connectedOn: "2024-03-01" };
    const warm = (await noteTaskWith({ job: { ...appleJob, status: "applied" }, contact: known }).start({ job: "job-1", input: { contact: "contact-1" } })).brief().task;
    assert.match(warm, /Applied: yes/);
    assert.match(warm, /connected on LinkedIn since 2024-03-01/);
  });

test("a whole note run: a long note refused, then both saved", async () =>
  {
    const work = await noteTaskWith().start({ job: "job-1", input: { contact: "contact-1" } });
    const ai = new ScriptedAi(
      [
        { role: "assistant", content: null, tool_calls: [toolCall("c1", "save_notes", { direct: "x".repeat(250), personal: PERSONAL })] },
        { role: "assistant", content: null, tool_calls: [toolCall("c2", "save_notes", { direct: DIRECT, personal: PERSONAL })] },
        { role: "assistant", content: "Both notes saved." },
      ]);
    const agent = new Agent({ ai, toolbox: new Toolbox(work.tools()), log: new MemoryLog() });
    const result = work.result(await agent.run(work.brief()));
    assert.match(ai.calls[1].messages.at(-1).content, /direct note is 250 characters/);
    assert.deepEqual(result, { contact: "contact-1", notes: [{ style: "direct", text: DIRECT }, { style: "personal", text: PERSONAL }] });
  });

test("a note run that never saves notes fails", async () =>
  {
    const work = await noteTaskWith().start({ job: "job-1", input: { contact: "contact-1" } });
    assert.throws(() => work.result("Done."), /without saving any notes/);
  });

test("the runner checks a task's input before saving the run, and keeps what it gives back", async () =>
  {
    const store = new MemoryRunStore();
    const inputFor = async (input) =>
      {
        if(!input.contact) throw new Error("Say which contact the notes are for.");
        return { contact: input.contact };
      };
    const task = { inputFor, start: async () => ({ tools: () => [], brief: () => ({}), result: () => ({}) }) };
    const runner = new Runner({ store, cap: new SpendingCap({ store, maxRuns: 5, maxUsd: 1 }), tasks: new Map([["note", task]]), buildAgent: () => ({ run: async () => "" }), logFor: () => new MemoryLog() });
    await assert.rejects(runner.submit("note", "job-1", {}), /Say which contact/);
    assert.equal(store.runs.length, 0);
    const run = await runner.submit("note", "job-1", { contact: "contact-1", extra: "dropped" });
    assert.deepEqual(run.input, { contact: "contact-1" });
    await runner.idle();
  });
