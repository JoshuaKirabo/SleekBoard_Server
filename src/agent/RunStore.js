// Every read and write of runs goes through here, so nothing else touches the database directly. It's Postgres
// (through Prisma), and tests hand the runner an in-memory stand-in instead.
//
// A run belongs to whoever started it: userId is asked for on each call, like JobStore. The spending cap's totals and
// the restart clean-up cover every run, since the cap guards one shared AI account.
//
// Runs come back in the shape the board has always had: id, job (or null), kind, status, steps and usage (oldest
// first), cost, budget, input ({ contact, link }, whichever it has), result, error and the timestamps.
const SHAPE = { steps: { orderBy: { id: "asc" } }, usage: { orderBy: { id: "asc" } } };
const LIVE = ["queued", "running"];

// Kinds of run that belong to no one job: Fill in reads a link before its job exists, and the email check reads your
// inbox. Every other kind needs one, as the Mongo model insisted.
export const JOBLESS_KINDS = ["fill", "email"];

// The step log's column holds 1,000 characters. Mongo let longer ones through on this write; Postgres would refuse
// them and stop the run, so they're cut instead.
const STEP_TEXT = 1000;

export class RunStore
  {
    constructor({ db, userId })
      {
        this.db = db;
        this.userId = userId;
      }

    async create({ kind, job, budget, input = {} })
      {
        if(!job && !JOBLESS_KINDS.includes(kind)) throw Object.assign(new Error("A run needs a job."), { status: 400 });
        const row = await this.db.run.create(
          {
            data:
              {
                userId: await this.userId(),
                kind,
                jobId: job ? String(job) : null,
                budget: budget || 0,
                inputContactId: input.contact ? String(input.contact) : null,
                inputLink: input.link ?? null,
              },
            include: SHAPE,
          });
        return this.shapeOf(row);
      }

    async find(id)
      {
        if(!id) return null;
        const row = await this.db.run.findFirst({ where: { id: String(id), userId: await this.userId() }, include: SHAPE });
        return row && this.shapeOf(row);
      }

    // A job's runs, newest first, so the card can pick up the last contact run and each contact's last notes.
    async forJob(jobId, limit = 20)
      {
        const rows = await this.db.run.findMany({ where: { jobId: String(jobId), userId: await this.userId() }, include: SHAPE, orderBy: { createdAt: "desc" }, take: limit });
        return rows.map((row) => this.shapeOf(row));
      }

    // A run's result so far, shown while it's still going. Fill in puts the filled card here before its contact search
    // ends, so the add sheet can show it. The run's finish writes the whole result over it.
    showResult(id, result)
      {
        return this.db.run.updateMany({ where: { id: String(id), status: "running" }, data: { result } });
      }

    // Gives a fill run its job once the card is added. Only a fill run with no job yet can get one, and only once.
    // True when it landed. Postgres refuses a job that isn't the run owner's.
    async attach(id, jobId)
      {
        const { count } = await this.db.run.updateMany({ where: { id: String(id), userId: await this.userId(), kind: "fill", jobId: null }, data: { jobId: String(jobId) } });
        return count > 0;
      }

    // Your yes or no on one of a finished run's suggestions. It only lands once per suggestion: the run is locked
    // while it's read and written, so two clicks at the same moment can't both answer it. True when it landed.
    async decide(id, index, decision)
      {
        const userId = await this.userId();
        return this.db.$transaction(async (tx) =>
          {
            const { count } = await tx.run.updateMany({ where: { id: String(id), userId, status: "done" }, data: { updatedAt: new Date() } });
            if(!count) return false;
            const { result } = await tx.run.findUnique({ where: { id: String(id) }, select: { result: true } });
            const suggestion = result?.contacts?.[index];
            if(!suggestion || "decision" in suggestion) return false;
            const contacts = result.contacts.map((one, at) => (at === index ? { ...one, decision } : one));
            await tx.run.update({ where: { id: String(id) }, data: { result: { ...result, contacts } } });
            return true;
          });
      }

    // Each write below only lands while the run is still in the state it expects. A run that timed out might still
    // be working in the background, and this stops it writing "done" over "failed" or adding steps after the end.
    markRunning(id)
      {
        return this.db.run.updateMany({ where: { id: String(id), status: "queued" }, data: { status: "running", startedAt: new Date() } });
      }

    // Locks the run while checking it's still going, so a finish can't land between the check and the step.
    addStep(id, { type, text = "", at = new Date() })
      {
        return this.db.$transaction(async (tx) =>
          {
            const { count } = await tx.run.updateMany({ where: { id: String(id), status: "running" }, data: { updatedAt: new Date() } });
            if(count) await tx.runStep.create({ data: { runId: String(id), type, text: String(text).slice(0, STEP_TEXT), at } });
          });
      }

    // The entry and the running total change together, so they can't drift apart. This one lands even after a run
    // ends, because a reply that came back late was still paid for.
    addUsage(id, entry)
      {
        const usage = { model: entry.model || "", tool: entry.tool || "", input: Math.round(entry.input || 0), output: Math.round(entry.output || 0), cost: entry.cost || 0 };
        return this.db.$transaction(async (tx) =>
          {
            const { count } = await tx.run.updateMany({ where: { id: String(id) }, data: { cost: { increment: usage.cost } } });
            if(count) await tx.runUsage.create({ data: { ...usage, runId: String(id) } });
          });
      }

    finish(id, result)
      {
        return this.db.run.updateMany({ where: { id: String(id), status: "running" }, data: { status: "done", result, finishedAt: new Date() } });
      }

    fail(id, message)
      {
        return this.db.run.updateMany({ where: { id: String(id), status: { in: LIVE } }, data: { status: "failed", error: String(message || ""), finishedAt: new Date() } });
      }

    // Dollars spent on runs started since this moment. A run that hasn't ended counts as its whole budget, or what
    // it's spent if that's more, because it can still spend that much. A run that's ended counts what it spent. Both
    // halves are read from the same snapshot, so a run ending in between isn't missed.
    async costSince(date)
      {
        const since = { createdAt: { gte: date } };
        const [ended, live] = await this.db.$transaction(
          [
            this.db.run.aggregate({ where: { ...since, status: { notIn: LIVE } }, _sum: { cost: true } }),
            this.db.run.findMany({ where: { ...since, status: { in: LIVE } }, select: { cost: true, budget: true } }),
          ],
          { isolationLevel: "RepeatableRead" });
        return (ended._sum.cost || 0) + live.reduce((total, run) => total + Math.max(run.cost, run.budget || 0), 0);
      }

    // Runs started today. Email checks don't count: the timer starts dozens a day, which would use up the runs meant
    // for your own presses. What they spend still counts, in costSince.
    countSince(date)
      {
        return this.db.run.count({ where: { createdAt: { gte: date }, kind: { not: "email" } } });
      }

    // The queue lives in memory, so a restart loses whatever was waiting or running. Calling those failed means no
    // card sits on "running" forever.
    failInterrupted()
      {
        return this.db.run.updateMany({ where: { status: { in: LIVE } }, data: { status: "failed", error: "The server restarted before this run finished.", finishedAt: new Date() } });
      }

    shapeOf(row)
      {
        const { userId, jobId, inputContactId, inputLink, steps = [], usage = [], ...run } = row;
        const input = {};
        if(inputContactId) input.contact = inputContactId;
        if(inputLink) input.link = inputLink;
        return {
          ...run,
          job: jobId,
          input,
          steps: steps.map(({ type, text, at }) => ({ type, text, at })),
          usage: usage.map(({ model, tool, input: tokensIn, output, cost }) => ({ model, tool, input: tokensIn, output, cost })),
        };
      }
  }
