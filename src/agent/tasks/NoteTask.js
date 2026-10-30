import { StatusCodes } from "http-status-codes";
import { NoteRun } from "./NoteRun.js";

const failure = (status, message) => Object.assign(new Error(message), { status });

// What a "note" run is: drafting two connection notes to one saved contact about one job. Same rung as the contact
// finder, DeepSeek V4.1 Flash. It reads at most the posting and writes, so 6 trips is plenty.
//
// jobs is anything with findById, and contacts is the ContactBook.
export class NoteTask
  {
    constructor({ jobs, contacts, fetchPage })
      {
        this.jobs = jobs;
        this.contacts = contacts;
        this.fetchPage = fetchPage;
        this.rung = 2;
        this.ability = "tools";
        this.maxSteps = 6;
      }

    // A note run needs a contact who's saved for this job. Checked before the run is saved, so a bad press doesn't
    // use up one of the day's runs.
    async inputFor(input, jobId)
      {
        const id = typeof input?.contact === "string" ? input.contact.trim() : "";
        if(!id) throw failure(StatusCodes.BAD_REQUEST, "Say which contact the notes are for.");
        const contact = await this.contacts.find(id);
        if(!contact) throw failure(StatusCodes.NOT_FOUND, "That contact doesn't exist.");
        if(!contact.jobs.some((job) => String(job) === String(jobId))) throw failure(StatusCodes.CONFLICT, `${contact.name} isn't saved for this job.`);
        return { contact: contact._id };
      }

    // The job and the contact are read when the run starts, so edits made while it waited still count.
    async start(run)
      {
        const job = await this.jobs.findById(run.job);
        if(!job) throw new Error("That job was deleted before its run started.");
        const contact = await this.contacts.find(run.input?.contact);
        if(!contact) throw new Error("That contact was deleted before its run started.");
        return new NoteRun({ job, contact, fetchPage: this.fetchPage });
      }
  }
