import { StatusCodes } from "http-status-codes";

// Comes back to the client as a 429 with a plain sentence, through errorHandler.
export class CapReachedError extends Error
  {
    constructor(message)
      {
        super(message);
        this.status = StatusCodes.TOO_MANY_REQUESTS;
      }
  }

// Stops a bug or a loop from draining the Together credit. It counts from the runs in Mongo, not from memory, so a
// restart doesn't reset the day. The clock gets handed in so a test can pick what "today" is.
export class SpendingCap
  {
    constructor({ store, maxRuns, maxUsd, now = () => new Date() })
      {
        this.store = store;
        this.maxRuns = maxRuns;
        this.maxUsd = maxUsd;
        this.now = now;
      }

    // Throws when a new run would go over either limit, and does nothing when there's room. budget is what the new run
    // may spend, and it has to fit in what's left of the day, so runs going at once can't add up past the limit. Both
    // totals are asked for at once, since each is a trip to Atlas (about 260 ms) and every click waits its turn behind
    // the Runner's lock.
    //
    // Each check asks "is there room?" and refuses unless the answer is a clear yes. Any comparison with NaN is false,
    // so a limit or total that isn't a real number refuses instead of letting every run through.
    async check(budget = 0)
      {
        const [runs, spent] = await Promise.all([this.runsToday(), this.spentToday()]);
        if(!(runs < this.maxRuns)) throw new CapReachedError(`That's all ${this.maxRuns} runs for today. Try again tomorrow.`);
        if(!(spent < this.maxUsd)) throw new CapReachedError(`Today's $${this.maxUsd} AI budget is used up. Try again tomorrow.`);
        if(!(spent + budget <= this.maxUsd)) throw new CapReachedError(`Today's $${this.maxUsd} AI budget doesn't have room for another run. Try again tomorrow.`);
      }

    runsToday()
      {
        return this.store.countSince(this.startOfToday());
      }

    // What finished runs spent plus the full budget of any still going, since those can spend up to it.
    spentToday()
      {
        return this.store.costSince(this.startOfToday());
      }

    // Midnight on this Mac's clock, so "today" means your day and not UTC's.
    startOfToday()
      {
        const today = this.now();
        today.setHours(0, 0, 0, 0);
        return today;
      }
  }
