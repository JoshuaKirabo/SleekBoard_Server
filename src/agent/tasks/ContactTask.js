import { ContactRun } from "./ContactRun.js";

// What a "contact" run is: where it starts on the model ladder, what the model has to be able to do, how many trips
// it gets, and how to start one. It starts on rung 2, DeepSeek V4.1 Flash, the roadmap's pick for the contact agent
// until a bake-off says otherwise.
//
// jobs is anything with findById, the Job model in the real server and a stand-in in tests.
export class ContactTask
  {
    // schools are the user's schools, for alumni. A run looks for about five people with 5 searches, so it gets more
    // trips and a bigger budget than the 12 steps and $0.10 one person needed.
    constructor({ jobs, exa, fetchPage, schools = [] })
      {
        this.jobs = jobs;
        this.schools = schools;
        this.maxUsd = 0.15;
        this.exa = exa;
        this.fetchPage = fetchPage;
        this.rung = 2;
        this.ability = "tools";
        this.maxSteps = 16;
      }

    // The job is read when the run starts, not when it's queued, so an edit made while it waited still counts.
    async start(run)
      {
        const job = await this.jobs.findById(run.job);
        if(!job) throw new Error("That job was deleted before its run started.");
        return new ContactRun({ job, exa: this.exa, fetchPage: this.fetchPage, schools: this.schools });
      }
  }
