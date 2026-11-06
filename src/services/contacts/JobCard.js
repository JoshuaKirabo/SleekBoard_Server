// The job's own Contact and Email fields, the ones the table and the panel show. When you take someone on for a job,
// their name (and email, if we have one) goes in, but only where the field is still empty: anything you typed there
// yourself stays.
export class JobCard
  {
    constructor({ jobs })
      {
        this.jobs = jobs;
      }

    // Each field only lands while it's still empty, checked in the same write, so a name you type at the same moment
    // isn't overwritten.
    async fill(jobId, contact)
      {
        await this.jobs.fillBlank(jobId, "contact", contact.name.slice(0, 120));
        if(contact.email) await this.jobs.fillBlank(jobId, "email", contact.email.slice(0, 200));
        return this.jobs.find(jobId);
      }
  }
