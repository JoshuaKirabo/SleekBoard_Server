// Every read and write of runs goes through here, so nothing else touches the database directly. It gets the
// Mongoose model handed in, and tests hand it an in-memory stand-in instead.
export class RunStore
  {
    constructor(Run)
      {
        this.Run = Run;
      }

    create({ kind, job, budget })
      {
        return this.Run.create({ kind, job, budget });
      }

    find(id)
      {
        return this.Run.findById(id);
      }

    // Each write below only lands while the run is still in the state it expects. A run that timed out might still
    // be working in the background, and this stops it writing "done" over "failed" or adding steps after the end.
    markRunning(id)
      {
        return this.Run.updateOne({ _id: id, status: "queued" }, { status: "running", startedAt: new Date() });
      }

    addStep(id, step)
      {
        return this.Run.updateOne({ _id: id, status: "running" }, { $push: { steps: step } });
      }

    // The entry and the running total change together, so they can't drift apart. This one lands even after a run
    // ends, because a reply that came back late was still paid for.
    addUsage(id, entry)
      {
        return this.Run.updateOne({ _id: id }, { $push: { usage: entry }, $inc: { cost: entry.cost } });
      }

    finish(id, result)
      {
        return this.Run.updateOne({ _id: id, status: "running" }, { status: "done", result, finishedAt: new Date() });
      }

    fail(id, message)
      {
        return this.Run.updateOne({ _id: id, status: { $in: ["queued", "running"] } }, { status: "failed", error: message, finishedAt: new Date() });
      }

    // Dollars spent on runs started since this moment. A run that hasn't ended counts as its whole budget, or what
    // it's spent if that's more, because it can still spend that much. A run that's ended counts what it spent.
    async costSince(date)
      {
        const live = { $in: ["$status", ["queued", "running"]] };
        const held = { $max: ["$cost", { $ifNull: ["$budget", 0] }] };
        const [total] = await this.Run.aggregate([{ $match: { createdAt: { $gte: date } } }, { $group: { _id: null, cost: { $sum: { $cond: [live, held, "$cost"] } } } }]);
        return total?.cost || 0;
      }

    countSince(date)
      {
        return this.Run.countDocuments({ createdAt: { $gte: date } });
      }

    // The queue lives in memory, so a restart loses whatever was waiting or running. Calling those failed means no
    // card sits on "running" forever.
    failInterrupted()
      {
        return this.Run.updateMany({ status: { $in: ["queued", "running"] } }, { status: "failed", error: "The server restarted before this run finished.", finishedAt: new Date() });
      }
  }
