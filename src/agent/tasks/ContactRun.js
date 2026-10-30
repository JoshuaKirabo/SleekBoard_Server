import { SeenText } from "../SeenText.js";
import { ReadPage } from "../tools/ReadPage.js";
import { WebSearch } from "../tools/WebSearch.js";
import { SuggestContact } from "../tools/SuggestContact.js";
import { CONTACT_PLAYBOOK } from "./contactPlaybook.js";

// Searches per run: enough for a recruiter, a hiring manager and two alumni (Josh, 2026-10-30), where career-ops' one
// contact needed 3.
export const SEARCHES = 5;

// Longest closing note the run keeps. The model's last words are a sentence or two; anything longer is rambling.
const NOTE_MAX = 1_000;

// The brief's line about the user's schools, for alumni.
export const schoolsLine = (schools) => (schools.length ? `The user's schools, for alumni: ${schools.join("; ")}` : "The user hasn't saved a school, so look for peers instead of alumni.");

// One contact-finder run for one job. Its tools are built here, fresh, so they share this run's SeenText and nothing
// carries over from another run. The Runner asks it for the brief and the tools, and hands it the agent's answer to
// turn into the run's result.
export class ContactRun
  {
    constructor({ job, exa, fetchPage, schools = [] })
      {
        this.job = job;
        this.schools = schools;
        this.seen = new SeenText();
        this.suggest = new SuggestContact({ seen: this.seen, schools });
        this.toolList = [new ReadPage({ fetchPage, exa, seen: this.seen }), new WebSearch({ exa, seen: this.seen, perRun: SEARCHES }), this.suggest];
      }

    tools()
      {
        return this.toolList;
      }

    brief()
      {
        return { system: CONTACT_PLAYBOOK, task: this.taskText() };
      }

    taskText()
      {
        const lines =
          [
            "Find who to contact about this job.",
            `Company: ${this.job.company}`,
            `Role: ${this.job.role}`,
            `Location: ${this.job.location || "not saved, so take it from the posting"}`,
            `Posting: ${this.posting() || "none saved, so go straight to searching"}`,
            schoolsLine(this.schools),
          ];
        return lines.join("\n");
      }

    // Links get saved the way people type them, like "stripe.com/jobs", and read_page needs the https:// in front.
    posting()
      {
        const link = (this.job.link || "").trim();
        if(!link) return "";
        return link.includes("://") ? link : `https://${link}`;
      }

    // What the run saves: the people suggest_contact accepted, and the agent's closing note on why, or why nobody.
    result(answer)
      {
        return { contacts: this.suggest.contacts, note: String(answer || "").slice(0, NOTE_MAX) };
      }
  }
