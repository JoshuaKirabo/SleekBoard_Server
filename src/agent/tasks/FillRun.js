import { SeenText } from "../SeenText.js";
import { ReadPage } from "../tools/ReadPage.js";
import { WebSearch } from "../tools/WebSearch.js";
import { SuggestContact } from "../tools/SuggestContact.js";
import { FillJob } from "../tools/FillJob.js";
import { FILL_PLAYBOOK } from "./fillPlaybook.js";
import { SEARCHES, schoolsLine } from "./ContactRun.js";

// Longest closing note the run keeps, the same as a contact run.
const NOTE_MAX = 1_000;

// One Fill in run: a link in, a filled card and a suggested contact out. Its tools share one SeenText, so the contact
// is checked against pages read in this same run.
//
// facts is what the link reader read off the posting's own job data, for free, before the run started. Workday
// postings only show their text with JavaScript, so read_page alone can come back empty there. The facts go in the
// brief and count as part of the posting page, so fill_job can check fields against them.
export class FillRun
  {
    constructor({ link, facts, exa, fetchPage, onFilled, schools = [] })
      {
        this.link = link;
        this.schools = schools;
        this.facts = facts;
        this.seen = new SeenText();
        this.fill = new FillJob({ seen: this.seen, onFilled: (job) => onFilled?.(this.withDomain(job)) });
        this.suggest = new SuggestContact({ seen: this.seen, schools });
        this.toolList = [new ReadPage({ fetchPage, exa, seen: this.seen }), this.fill, new WebSearch({ exa, seen: this.seen, perRun: SEARCHES }), this.suggest];
        if(facts) this.seen.add(link, this.factsText());
      }

    tools()
      {
        return this.toolList;
      }

    brief()
      {
        return { system: FILL_PLAYBOOK, task: this.taskText() };
      }

    taskText()
      {
        const data = this.facts ? `The page's own job data (read by code from the posting): ${this.factsText()}` : "The page publishes no job data, so read the posting itself.";
        return ["Fill in this job from its posting, then find who to contact about it.", `Posting: ${this.link}`, data, schoolsLine(this.schools)].join("\n");
      }

    // about is the posting's own text, for a site whose page is empty without JavaScript and whose data names no
    // employer (UKG). The company's name is in there, and it counts as read, so fill_job can check it.
    factsText()
      {
        const { company, role, location, deadline, about } = this.facts;
        return [company && `Company: ${company}.`, role && `Job title: ${role}.`, location && `Location: ${location}.`, deadline && `Closes: ${deadline}.`, about && `The posting says: ${about}`].filter(Boolean).join(" ");
      }

    // The employer's website, for the card's logo, when the link reader found one.
    withDomain(job)
      {
        return { ...job, domain: this.facts?.domain || "" };
      }

    // The card the run filled in (null if it couldn't read the posting), the people it suggests, and its closing note.
    result(answer)
      {
        return { job: this.fill.job ? this.withDomain(this.fill.job) : null, contacts: this.suggest.contacts, note: String(answer || "").slice(0, NOTE_MAX) };
      }
  }
