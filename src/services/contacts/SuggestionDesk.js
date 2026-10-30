import { StatusCodes } from "http-status-codes";

export const DECISIONS = ["accept", "reject"];

const failure = (status, message) => Object.assign(new Error(message), { status });

// Where you say yes or no to the people a contact-finder run suggested. Yes saves them to your contacts, the only
// way a run's suggestion becomes a saved contact, the way career-ops never saves a contact before the candidate
// confirms. Either way the answer goes on the run, so the card shows it next time.
//
// The person is copied from the run itself, never from the request, so the browser can't slip in someone the finder
// didn't check.
export class SuggestionDesk
  {
    constructor({ runs, jobs, book, card })
      {
        this.runs = runs;
        this.jobs = jobs;
        this.book = book;
        this.card = card;
      }

    async decide(runId, index, decision)
      {
        if(!DECISIONS.includes(decision)) throw failure(StatusCodes.BAD_REQUEST, `decision has to be ${DECISIONS.join(" or ")}.`);
        const run = await this.runs.find(runId);
        const suggestion = this.suggestionOf(run, index);
        const job = await this.jobs.findById(run.job);
        if(!job) throw failure(StatusCodes.NOT_FOUND, "That run's job was deleted.");
        const saved = decision === "accept" ? await this.accept(suggestion, job) : { contact: null, job };
        await this.runs.decide(run.id, index, decision);
        return { ...saved, run: await this.runs.find(run.id) };
      }

    // The suggestion at that spot, as long as the run's a finished contact run and nobody's answered it yet.
    suggestionOf(run, index)
      {
        if(!run) throw failure(StatusCodes.NOT_FOUND, "That run doesn't exist.");
        if(run.kind !== "contact" || run.status !== "done") throw failure(StatusCodes.CONFLICT, "Only a finished contact run has suggestions to answer.");
        const suggestion = Number.isInteger(index) ? run.result?.contacts?.[index] : undefined;
        if(!suggestion) throw failure(StatusCodes.NOT_FOUND, "That suggestion doesn't exist.");
        if(suggestion.decision) throw failure(StatusCodes.CONFLICT, `You already answered ${suggestion.name}.`);
        return suggestion;
      }

    async accept(suggestion, job)
      {
        const { name, title, type, location, link, quote, reason } = suggestion;
        const contact = await this.book.save({ name, company: job.company, type, title, location: location === "unknown" ? "" : location, link, quote, reason, source: "run" }, job._id);
        return { contact, job: await this.card.fill(job._id, contact) };
      }
  }
