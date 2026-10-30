import { test } from "node:test";
import assert from "node:assert/strict";
import { SeenText } from "../../src/agent/SeenText.js";
import { SuggestContact } from "../../src/agent/tools/SuggestContact.js";
import { ContactTask } from "../../src/agent/tasks/ContactTask.js";
import { ExaClient } from "../../src/agent/ExaClient.js";
import { WebSearch } from "../../src/agent/tools/WebSearch.js";
import { ReadPage } from "../../src/agent/tools/ReadPage.js";
import { Toolbox } from "../../src/agent/Toolbox.js";
import { Agent } from "../../src/agent/Agent.js";
import { FakeFetch, jsonResponse, ScriptedAi, MemoryLog, toolCall } from "../fakes.js";

const PROFILE = "https://www.linkedin.com/in/samrivera";
const PROFILE_TEXT = "# Sam Rivera\n\nTechnical Recruiter at Apple · Cupertino, California · Hiring for Apple's   iOS teams.";

const seenWith = (pages) =>
  {
    const seen = new SeenText();
    Object.entries(pages).forEach(([link, text]) => seen.add(link, text));
    return seen;
  };

const sam = (changes = {}) => ({ name: "Sam Rivera", title: "Technical Recruiter", type: "recruiter", location: "Cupertino, California", link: PROFILE, quote: "Technical Recruiter at Apple", reason: "Recruits for iOS in Cupertino.", ...changes });

test("one page matches however the link is written", () =>
  {
    const seen = seenWith({ [PROFILE]: PROFILE_TEXT });
    for(const link of ["https://linkedin.com/in/samrivera", "http://www.linkedin.com/in/SamRivera/", "linkedin.com/in/samrivera?trk=x#top", "https://uk.linkedin.com/in/samrivera"]) assert.equal(seen.has(link), true, link);
    assert.equal(seen.has("https://linkedin.com/in/samriver"), false);
    assert.equal(seen.has("not a link at all"), false);
  });

test("a quote matches give or take case, spacing, curly quotes and Markdown", () =>
  {
    const seen = seenWith({ "https://apple.com/team": "Meet **Jordan Lee**, who’s leading   the Maps team." });
    assert.equal(seen.shows("https://apple.com/team", "jordan lee, who's leading the maps team"), true);
    assert.equal(seen.shows("https://apple.com/team", "Jordan Lee, who leads the Maps team"), false);
    assert.equal(seen.shows("https://apple.com/team", ""), false);
    assert.equal(seen.shows("https://apple.com/other", "Jordan Lee"), false);
  });

test("a contact whose quote, name and place are on its page is kept", async () =>
  {
    const tool = new SuggestContact({ seen: seenWith({ [PROFILE]: PROFILE_TEXT }) });
    assert.match(await tool.run(sam()), /Saved Sam Rivera as suggestion 1 of 5/);
    assert.deepEqual(tool.contacts, [sam()]);
  });

test("a link no tool returned this run is refused", async () =>
  {
    const tool = new SuggestContact({ seen: seenWith({ [PROFILE]: PROFILE_TEXT }) });
    await assert.rejects(tool.run(sam({ link: "https://linkedin.com/in/someone-else" })), /didn't come from a search result/);
    assert.equal(tool.contacts.length, 0);
  });

test("a quote that isn't on the page is refused", async () =>
  {
    const tool = new SuggestContact({ seen: seenWith({ [PROFILE]: PROFILE_TEXT }) });
    await assert.rejects(tool.run(sam({ quote: "Senior Recruiter at Apple since 2019" })), /That quote isn't on/);
  });

test("a name the page doesn't show is refused, even with a real quote", async () =>
  {
    const tool = new SuggestContact({ seen: seenWith({ [PROFILE]: PROFILE_TEXT }) });
    await assert.rejects(tool.run(sam({ name: "Samantha Rivers" })), /isn't named on that page/);
  });

test("a place the page doesn't say is refused, and unknown is allowed", async () =>
  {
    const tool = new SuggestContact({ seen: seenWith({ [PROFILE]: PROFILE_TEXT }) });
    await assert.rejects(tool.run(sam({ location: "Chicago, Illinois" })), /isn't on that page/);
    await tool.run(sam({ location: "unknown" }));
    assert.equal(tool.contacts[0].location, "unknown");
  });

test("one of each kind, two alumni, never the same person twice", async () =>
  {
    const seen = seenWith(
      {
        [PROFILE]: PROFILE_TEXT,
        "https://linkedin.com/in/jlee": "Jordan Lee. Engineering Manager at Apple, iOS Foundations. Cupertino, California",
        "https://linkedin.com/in/pk": "Priya Kumar. Recruiter at Apple. Cupertino, California",
      });
    const tool = new SuggestContact({ seen });
    await tool.run(sam());
    await assert.rejects(tool.run(sam({ link: "https://linkedin.com/in/samrivera/" })), /already suggested Sam Rivera/);
    await tool.run({ ...sam(), name: "Jordan Lee", title: "Engineering Manager", type: "hiring_manager", link: "https://linkedin.com/in/jlee", quote: "Engineering Manager at Apple, iOS Foundations" });
    await assert.rejects(tool.run({ ...sam(), name: "Priya Kumar", link: "https://linkedin.com/in/pk", quote: "Priya Kumar. Recruiter at Apple" }), /already have 1 recruiter contact/);
    assert.deepEqual(tool.contacts.map((contact) => contact.name), ["Sam Rivera", "Jordan Lee"]);
  });

test("alumni need the user's school on their own page", async () =>
  {
    const seen = seenWith(
      {
        "https://linkedin.com/in/ana": "Ana Ortiz. Software Engineer at Apple. Arizona State University, B.S. Computer Science. Cupertino, California",
        "https://linkedin.com/in/ben": "Ben Cho. Software Engineer at Apple. Stanford University. Cupertino, California",
      });
    const ana = { name: "Ana Ortiz", title: "Software Engineer", type: "alumni", location: "Cupertino, California", link: "https://linkedin.com/in/ana", quote: "Software Engineer at Apple", reason: "ASU grad on the iOS team." };
    const ben = { ...ana, name: "Ben Cho", link: "https://linkedin.com/in/ben" };
    await assert.rejects(new SuggestContact({ seen }).run(ana), /hasn't saved a school/);
    const tool = new SuggestContact({ seen, schools: ["Arizona State University", "ASU"] });
    await tool.run(ana);
    await assert.rejects(tool.run(ben), /doesn't show Arizona State University or ASU/);
    await tool.run({ ...ben, type: "peer" });
    assert.deepEqual(tool.contacts.map((contact) => contact.type), ["alumni", "peer"]);
  });

test("no more than five people in all", async () =>
  {
    const pages = Object.fromEntries(["a", "b", "c", "d", "e", "f"].map((id) => [`https://linkedin.com/in/${id}`, `Person ${id.toUpperCase()}x Engineer at Apple, ASU`]));
    const tool = new SuggestContact({ seen: seenWith(pages), schools: ["ASU"], maxContacts: 5 });
    const kinds = ["recruiter", "hiring_manager", "alumni", "alumni", "peer", "peer"];
    for(const [index, id] of ["a", "b", "c", "d", "e"].entries()) await tool.run({ name: `Person ${id.toUpperCase()}x`, title: "Engineer", type: kinds[index], location: "unknown", link: `https://linkedin.com/in/${id}`, quote: "Engineer at Apple, ASU", reason: "r" });
    await assert.rejects(tool.run({ name: "Person Fx", title: "Engineer", type: "peer", location: "unknown", link: "https://linkedin.com/in/f", quote: "Engineer at Apple, ASU", reason: "r" }), /already suggested 5 people/);
  });

test("a missing field, a made-up type or a too-short quote is refused before any check", async () =>
  {
    const tool = new SuggestContact({ seen: seenWith({ [PROFILE]: PROFILE_TEXT }) });
    await assert.rejects(tool.run(sam({ link: "" })), /needs link/);
    await assert.rejects(tool.run(sam({ type: "ceo" })), /type has to be one of/);
    await assert.rejects(tool.run(sam({ quote: "Apple" })), /too short/);
    await assert.rejects(tool.run(null), /needs name/);
  });

test("web_search and read_page note what they showed, each under its own link", async () =>
  {
    const seen = new SeenText();
    const exa = new ExaClient({ apiKey: "k", fetch: new FakeFetch([jsonResponse(200, { results: [{ title: "Sam Rivera", url: PROFILE, highlights: [PROFILE_TEXT] }, { title: "Other", url: "https://x.com/a", highlights: ["Nothing here"] }], costDollars: { total: 0.007 } })]).fetch });
    await new WebSearch({ exa, seen }).run({ query: "Apple recruiter Cupertino" });
    assert.equal(seen.shows(PROFILE, "Technical Recruiter at Apple"), true);
    assert.equal(seen.shows("https://x.com/a", "Technical Recruiter at Apple"), false);

    const fetchPage = async () => ({ html: "<p>Posted by Jordan Lee, Engineering Manager</p>", url: new URL("https://jobs.apple.com/en-us/details/1"), type: "text/html" });
    await new ReadPage({ fetchPage, seen }).run({ url: "https://apple.co/job1" });
    assert.equal(seen.shows("https://apple.co/job1", "Posted by Jordan Lee"), true);
    assert.equal(seen.shows("https://jobs.apple.com/en-us/details/1", "Posted by Jordan Lee"), true);
  });

const appleJob = { company: "Apple", role: "iOS Engineer Intern", location: "Cupertino, CA", link: "jobs.apple.com/en-us/details/1" };

const contactTaskWith = ({ job = appleJob, fetchPage, exaAnswers = [] } = {}) =>
  {
    const exaFetch = new FakeFetch(exaAnswers);
    const exa = new ExaClient({ apiKey: "k", fetch: exaFetch.fetch });
    const jobs = { findById: async (id) => (id === "job-1" ? job : null) };
    return { exaFetch, task: new ContactTask({ jobs, exa, fetchPage }) };
  };

test("the brief names the job, its location and its posting with https in front", async () =>
  {
    const { task } = contactTaskWith();
    const work = await task.start({ job: "job-1" });
    const { system, task: text } = work.brief();
    assert.match(system, /a recruiter in Chicago is the wrong person/);
    assert.match(text, /Company: Apple/);
    assert.match(text, /Location: Cupertino, CA/);
    assert.match(text, /Posting: https:\/\/jobs\.apple\.com\/en-us\/details\/1/);
    assert.deepEqual(work.tools().map((tool) => tool.name), ["read_page", "web_search", "suggest_contact"]);
  });

test("a job with no link or location says so in the brief", async () =>
  {
    const { task } = contactTaskWith({ job: { company: "Linear", role: "Design Engineer", location: "", link: "" } });
    const { task: text } = (await task.start({ job: "job-1" })).brief();
    assert.match(text, /Location: not saved/);
    assert.match(text, /Posting: none saved/);
  });

test("a run whose job was deleted fails with a plain message", async () =>
  {
    const { task } = contactTaskWith();
    await assert.rejects(task.start({ job: "gone" }), /That job was deleted/);
  });

test("a whole run: read the posting, search, a made-up quote refused, the real one kept", async () =>
  {
    // Long enough to count as a real page, so read_page doesn't fall back to Exa's copy of it.
    const fetchPage = async () => ({ html: `<h1>iOS Engineer Intern</h1><p>Cupertino, California. Join the iOS Foundations team.</p><p>${"You will build the frameworks every iOS app relies on. ".repeat(10)}</p>`, url: new URL("https://jobs.apple.com/en-us/details/1"), type: "text/html" });
    const exaAnswers = [jsonResponse(200, { results: [{ title: "Sam Rivera", url: PROFILE, highlights: [PROFILE_TEXT] }], costDollars: { total: 0.007 } })];
    const { task, exaFetch } = contactTaskWith({ fetchPage, exaAnswers });
    const work = await task.start({ job: "job-1" });

    const ai = new ScriptedAi(
      [
        { role: "assistant", content: null, tool_calls: [toolCall("c1", "read_page", { url: "https://jobs.apple.com/en-us/details/1" })] },
        { role: "assistant", content: null, tool_calls: [toolCall("c2", "web_search", { query: "Apple iOS recruiter Cupertino" })] },
        { role: "assistant", content: null, tool_calls: [toolCall("c3", "suggest_contact", sam({ quote: "Lead recruiter for Apple interns" }))] },
        { role: "assistant", content: null, tool_calls: [toolCall("c4", "suggest_contact", sam())] },
        { role: "assistant", content: "Sam Rivera recruits for Apple's iOS teams in Cupertino." },
      ]);
    const log = new MemoryLog();
    const agent = new Agent({ ai, toolbox: new Toolbox(work.tools()), log });
    const result = work.result(await agent.run(work.brief()));

    assert.equal(exaFetch.requests[0].body.query, "Apple iOS recruiter Cupertino");
    assert.match(ai.calls[3].messages.at(-1).content, /That quote isn't on/);
    assert.deepEqual(result, { contacts: [sam()], note: "Sam Rivera recruits for Apple's iOS teams in Cupertino." });
  });

test("a run that confirms nobody comes back empty with its note", async () =>
  {
    const { task } = contactTaskWith({ job: { ...appleJob, link: "" } });
    const work = await task.start({ job: "job-1" });
    assert.deepEqual(work.result("Nobody I could confirm."), { contacts: [], note: "Nobody I could confirm." });
  });

test("two runs don't share what they've seen", async () =>
  {
    const { task } = contactTaskWith();
    const first = await task.start({ job: "job-1" });
    const second = await task.start({ job: "job-1" });
    first.seen.add(PROFILE, PROFILE_TEXT);
    assert.equal(second.seen.has(PROFILE), false);
    assert.notEqual(first.tools()[2], second.tools()[2]);
  });

// ---------- Problems #29 and #30, from the 2026-10-30 break test ----------

const keptLink = async (link) =>
  {
    const tool = new SuggestContact({ seen: seenWith({ [PROFILE]: PROFILE_TEXT }) });
    try
      {
        await tool.run(sam({ link }));
        return tool.contacts[0].link;
      }
    catch(error)
      {
        return `refused: ${error.message}`;
      }
  };

test("#29: links that aren't web pages are refused", async () =>
  {
    for(const link of ["javascript://www.linkedin.com/in/samrivera?%0Aalert(document.domain)", "javascript://linkedin.com/in/samrivera#%0Aalert(1)", "data://linkedin.com/in/samrivera", "ftp://linkedin.com/in/samrivera"])
      {
        assert.match(await keptLink(link), /refused: That link didn't come from/, link);
      }
  });

test("#29: the kept link is the one the tool gave, not the model's copy", async () =>
  {
    for(const link of ["linkedin.com/in/samrivera", "https://evil.example@www.linkedin.com/in/samrivera", "https://linkedin.com/in/samrivera?redirect=https://evil.example", "https://linkedin.com:8443/in/samrivera", "HTTPS://WWW.LINKEDIN.COM/IN/SAMRIVERA/"])
      {
        assert.equal(await keptLink(link), PROFILE, link);
      }
  });

test("#30: a short place doesn't match inside other words", async () =>
  {
    const tool = new SuggestContact({ seen: seenWith({ [PROFILE]: "Sam Rivera. Technical Recruiter at Apple. Chicago, Illinois. Recruiting careers." }) });
    await assert.rejects(tool.run(sam({ location: "CA" })), /"CA" isn't on that page/);
    await tool.run(sam({ location: "Chicago" }));
  });

test("#30: names have to be whole and full", async () =>
  {
    const seen = seenWith({ [PROFILE]: "Samantha Rivera. Technical Recruiter at Apple." });
    await assert.rejects(new SuggestContact({ seen }).run(sam({ name: "Sam" })), /full name/);
    await assert.rejects(new SuggestContact({ seen }).run(sam({ name: "a b" })), /full name/);
    await assert.rejects(new SuggestContact({ seen }).run(sam({ name: "Sam Rivera" })), /isn't named on that page/);
  });

test("#30: padding can't stretch a short quote past the minimum", async () =>
  {
    const tool = new SuggestContact({ seen: seenWith({ [PROFILE]: PROFILE_TEXT }) });
    await assert.rejects(tool.run(sam({ quote: "______________ at" })), /too short/);
    await assert.rejects(tool.run(sam({ quote: "**Recruiter** at" })), /too short/);
  });

test("#30: on a team page the name has to sit next to the quote", async () =>
  {
    const team = "https://apple.com/team";
    const text = `Jordan Lee, Office Manager. ${"Our offices span many cities and teams. ".repeat(12)} Priya Kumar, Head of Recruiting at Apple.`;
    const tool = new SuggestContact({ seen: seenWith({ [team]: text }) });
    await assert.rejects(tool.run(sam({ name: "Jordan Lee", quote: "Head of Recruiting at Apple", link: team, location: "unknown" })), /within 300 characters/);
    await tool.run(sam({ name: "Priya Kumar", quote: "Head of Recruiting at Apple", link: team, location: "unknown" }));
    assert.equal(tool.contacts[0].name, "Priya Kumar");
  });

test("#30: a quote can't be stitched across two reads of one page", async () =>
  {
    const seen = new SeenText();
    seen.add(PROFILE, "Sam Rivera worked at");
    seen.add(PROFILE, "Apple until 2019, now at Google");
    await assert.rejects(new SuggestContact({ seen }).run(sam({ quote: "Sam Rivera worked at Apple" })), /That quote isn't on/);
  });

test("#30: a page that repeats its own link's words can't prove anyone", async () =>
  {
    const echo = "https://search.example/?q=Jane+Doe+Recruiter+at+Stripe";
    const tool = new SuggestContact({ seen: seenWith({ [echo]: "Results for Jane Doe Recruiter at Stripe" }) });
    await assert.rejects(tool.run(sam({ name: "Jane Doe", quote: "Jane Doe Recruiter at Stripe", link: echo })), /repeats the words in its own link/);
  });

test("#30: other sites keep the case of their path and their ?query", () =>
  {
    const seen = seenWith({ "https://example.com/team?id=1": "Page one", "https://example.com/People/Jane": "Jane" });
    assert.equal(seen.has("https://example.com/team?id=2"), false);
    assert.equal(seen.has("https://example.com/people/jane"), false);
    assert.equal(seen.has("https://www.example.com/People/Jane/"), true);
  });
