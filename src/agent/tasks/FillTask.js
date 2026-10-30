import { StatusCodes } from "http-status-codes";
import { FillRun } from "./FillRun.js";

const MAX_LINK = 2_000;

const failure = (status, message) => Object.assign(new Error(message), { status });

// What a "fill" run is: Fill in in the add sheet. It starts from a link, before any job exists, reads the posting,
// fills the card and finds the contact, all in one run (Josh, 2026-10-30). Same rung as the contact finder. It gets two
// more trips than a contact run, for reading the posting and filling the card.
//
// readJob is the link reader, run first for the posting's own job data. store is the RunStore, so the filled card
// shows up on the run before the contact search ends.
export class FillTask
  {
    constructor({ readJob, exa, fetchPage, store, schools = [] })
      {
        this.readJob = readJob;
        this.schools = schools;
        this.maxUsd = 0.15;
        this.exa = exa;
        this.fetchPage = fetchPage;
        this.store = store;
        this.rung = 2;
        this.ability = "tools";
        this.maxSteps = 18;
      }

    // A fill run needs a web link. Checked before the run is saved, so a bad paste doesn't use up one of the day's runs.
    inputFor(input)
      {
        const link = typeof input?.link === "string" ? input.link.trim() : "";
        if(!link) throw failure(StatusCodes.BAD_REQUEST, "Paste the job's link.");
        if(link.length > MAX_LINK) throw failure(StatusCodes.BAD_REQUEST, `That link is ${link.length} characters. Keep it under ${MAX_LINK}.`);
        const url = this.urlOf(link);
        if(!url) throw failure(StatusCodes.BAD_REQUEST, "That doesn't look like a web link.");
        return { link: url.href };
      }

    urlOf(link)
      {
        try
          {
            const url = new URL(link.includes("://") ? link : `https://${link}`);
            return ["http:", "https:"].includes(url.protocol) ? url : null;
          }
        catch
          {
            return null;
          }
      }

    // The link reader goes first and costs nothing. Only a posting's own job data counts as facts (JobPosting data, or
    // Greenhouse's API). A page title doesn't: LinkedIn's stand-in search page gave "Deputy Commissioner Jobs" for an
    // Amazon posting. A posting it can't read just means no facts, and the run reads the page itself.
    async start(run)
      {
        const link = run.input?.link;
        if(!link) throw new Error("This run has no link to read.");
        const read = await this.readJob(link).catch(() => null);
        const facts = ["jobposting", "greenhouse"].includes(read?.source) ? read : null;
        const onFilled = (job) => this.store.showResult(run.id, { job, contacts: [], note: "" });
        return new FillRun({ link, facts, exa: this.exa, fetchPage: this.fetchPage, onFilled, schools: this.schools });
      }
  }
