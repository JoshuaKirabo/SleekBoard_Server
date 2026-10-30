import { StatusCodes } from "http-status-codes";

const notFound = (message) => Object.assign(new Error(message), { status: StatusCodes.NOT_FOUND });

// career-ops' step 0: before any cold search, check whether you already know someone at the company. Two places to
// look: people you saved for an earlier job there (contact-lookup.mjs), and your LinkedIn connections
// (linkedin-join.mjs).
//
// career-ops stops and asks "reach out to her, or search cold?" before searching. Our runs happen in the background
// and can't ask, so the board asks instead, before a run starts: it shows these leads with a "Search cold instead"
// button. Picking a lead costs nothing, because no run happens at all.
export class WarmLeads
  {
    constructor({ book, connections, card })
      {
        this.book = book;
        this.connections = connections;
        this.card = card;
      }

    // Who's saved for this job, the people you know at its company, and a LinkedIn link to look for 2nd-degree ones
    // yourself. A connection who's already a saved contact only shows once, as the contact (career-ops flags them as
    // alreadyInPhonebook).
    async forJob(job)
      {
        const [saved, contacts, connections] = await Promise.all([this.book.forJob(job._id), this.book.atCompany(job.company, job._id), this.connections.matchesFor(job.company)]);
        const known = new Set([...saved, ...contacts].map((contact) => this.book.nameKeyOf(contact.name)));
        const fresh = connections.filter((connection) => !known.has(this.book.nameKeyOf(connection.name)));
        return { saved, leads: { contacts, connections: fresh, secondDegreeSearch: this.connections.secondDegreeSearch(job.company) } };
      }

    // Takes on someone you already saved, for this job too.
    async useContact(job, contactId)
      {
        const contact = await this.book.link(contactId, job._id);
        if(!contact) throw notFound("That contact doesn't exist.");
        return { contact, job: await this.card.fill(job._id, contact) };
      }

    // Turns a LinkedIn connection into a saved contact for this job, the step career-ops leaves to you by hand
    // (pasting rows from linkedin-join's --tsv into contacts.tsv). Saved under the job's company, since that's the
    // employer you matched them to. They're an internal referral: you're already connected, which is the real prior
    // relationship career-ops asks for before a referral ask.
    async useConnection(job, connectionId)
      {
        const connection = await this.connections.find(connectionId);
        if(!connection) throw notFound("That connection doesn't exist. Upload your connections again.");
        const fields = { name: connection.name, company: job.company, type: "internal_referral", title: connection.title, email: connection.email, link: connection.linkedin, connectedOn: connection.connectedOn, source: "linkedin" };
        const contact = await this.book.save(fields, job._id);
        return { contact, job: await this.card.fill(job._id, contact) };
      }
  }
