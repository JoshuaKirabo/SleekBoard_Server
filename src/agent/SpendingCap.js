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

    // Throws when a new run would go over either limit, and does nothing when there's room.
    async check()
      {
        if(await this.runsToday() >= this.maxRuns) throw new CapReachedError(`That's all ${this.maxRuns} runs for today. Try again tomorrow.`);
        if(await this.spentToday() >= this.maxUsd) throw new CapReachedError(`Today's $${this.maxUsd} AI budget is used up. Try again tomorrow.`);
      }

    runsToday()
      {
        return this.store.countSince(this.startOfToday());
      }

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
