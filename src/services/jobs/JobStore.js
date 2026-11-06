import { randomBytes } from "node:crypto";

// Every read and write of jobs goes through here, and every one of them is limited to one person's jobs: userId is
// asked for on each call, so a store can follow whoever is signed in. Until sign-in exists it's the owner's.
//
// Jobs come back in the shape the board has always had: id, the fields, moves (oldest first, as { from, to, at,
// source }), the reply, replySuggestion ({ to, confidence, at } or null) and the two timestamps. The owner and
// Postgres' own ids stay in here.
//
// Writes that depend on where a card is only land if it's still there, so a drag and an email moving the same card at
// the same moment can't both land. Those come back null.
const SHAPE = { moves: { orderBy: { id: "asc" } }, replySuggestion: true };

// Thrown inside a transaction to undo it when a check fails part way.
class Stale extends Error {}

export class JobStore
  {
    constructor({ db, userId })
      {
        this.db = db;
        this.userId = userId;
      }

    // Most recently touched first, the board's order.
    async list()
      {
        const rows = await this.db.job.findMany({ where: { userId: await this.userId() }, include: SHAPE, orderBy: { updatedAt: "desc" } });
        return rows.map((row) => this.shapeOf(row));
      }

    // One job, or null when it doesn't exist or isn't this person's. Ids from Mongo come in as ObjectIds, hence String.
    async find(id)
      {
        if(!id) return null;
        const row = await this.db.job.findFirst({ where: { id: String(id), userId: await this.userId() }, include: SHAPE });
        return row && this.shapeOf(row);
      }

    // New jobs get a Mongo-style id (24 hex characters) while contacts and runs still live in Mongo, since those keep
    // job ids as ObjectIds and would refuse a uuid. Once they move, the schema's uuid default takes over.
    async create(fields)
      {
        const row = await this.db.job.create({ data: { ...fields, id: randomBytes(12).toString("hex"), userId: await this.userId() }, include: SHAPE });
        return this.shapeOf(row);
      }

    // Plain field changes, not lane moves. null if the job isn't there.
    async update(id, fields)
      {
        const userId = await this.userId();
        const { count } = await this.db.job.updateMany({ where: { id: String(id), userId }, data: fields });
        return count ? this.find(id) : null;
      }

    // Deletes a job and gives back what it was. Its moves, suggestion and contact links go with it. Runs that point at
    // it keep their record, so the spending cap still counts them, with the job emptied first: Postgres won't delete a
    // job a run still points at.
    async remove(id)
      {
        const userId = await this.userId();
        return this.db.$transaction(async (tx) =>
          {
            const row = await tx.job.findFirst({ where: { id: String(id), userId }, include: SHAPE });
            if(!row) return null;
            await tx.run.updateMany({ where: { jobId: row.id, userId }, data: { jobId: null } });
            await tx.job.delete({ where: { id: row.id } });
            return this.shapeOf(row);
          });
      }

    // Moves the card from `from` to `step.to`, writes the step down and clears any suggestion, all at once. `also` is
    // anything else to save with it, like the reply that moved it. null if the card wasn't in `from` any more.
    async moveLane(id, from, step, also = {})
      {
        const userId = await this.userId();
        return this.whileStill(async (tx) =>
          {
            const { count } = await tx.job.updateMany({ where: { id: String(id), userId, status: from }, data: { ...also, status: step.to } });
            if(!count) throw new Stale();
            await tx.jobMove.create({ data: { ...step, jobId: String(id) } });
            await tx.replySuggestion.deleteMany({ where: { jobId: String(id) } });
            return tx.job.findUnique({ where: { id: String(id) }, include: SHAPE });
          });
      }

    // Takes the last move back off and puts the card in `back`. Only while the card is still in `from` with exactly
    // `count` moves, the last of them back → from, so an undo can't take back a move it never saw.
    async undoLane(id, from, back, count)
      {
        const userId = await this.userId();
        return this.whileStill(async (tx) =>
          {
            const { count: moved } = await tx.job.updateMany({ where: { id: String(id), userId, status: from }, data: { status: back } });
            if(!moved) throw new Stale();
            const moves = await tx.jobMove.findMany({ where: { jobId: String(id) }, orderBy: { id: "asc" } });
            const last = moves.at(-1);
            if(moves.length !== count || last?.from !== back || last?.to !== from) throw new Stale();
            await tx.jobMove.delete({ where: { id: last.id } });
            await tx.replySuggestion.deleteMany({ where: { jobId: String(id) } });
            return tx.job.findUnique({ where: { id: String(id) }, include: SHAPE });
          });
      }

    // Sets a field only while it's still empty, checked in the same write, so something typed at the same moment
    // isn't overwritten.
    async fillBlank(id, field, value)
      {
        const userId = await this.userId();
        await this.db.job.updateMany({ where: { id: String(id), userId, [field]: "" }, data: { [field]: value } });
      }

    // Saves a reply on the card, and the AI's suggestion when there is one (null clears it).
    async noteReply(id, reply, suggestion)
      {
        const userId = await this.userId();
        return this.whileStill(async (tx) =>
          {
            const { count } = await tx.job.updateMany({ where: { id: String(id), userId }, data: reply });
            if(!count) throw new Stale();
            if(suggestion !== undefined) await this.setSuggestion(tx, String(id), suggestion);
            return tx.job.findUnique({ where: { id: String(id) }, include: SHAPE });
          });
      }

    // Clears a suggestion you dismissed. Touches the card too, so it comes back up the board like before.
    async clearSuggestion(id)
      {
        return this.noteReply(id, { updatedAt: new Date() }, null);
      }

    async setSuggestion(tx, jobId, suggestion)
      {
        await tx.replySuggestion.deleteMany({ where: { jobId } });
        if(suggestion) await tx.replySuggestion.create({ data: { ...suggestion, jobId } });
      }

    // Runs a write in one transaction. A Stale check part way undoes all of it and gives back null.
    async whileStill(work)
      {
        try
          {
            const row = await this.db.$transaction(work);
            return this.shapeOf(row);
          }
        catch(error)
          {
            if(error instanceof Stale) return null;
            throw error;
          }
      }

    shapeOf(row)
      {
        const { userId, moves = [], replySuggestion = null, ...job } = row;
        return {
          ...job,
          moves: moves.map(({ from, to, at, source }) => ({ from, to, at, source })),
          replySuggestion: replySuggestion && { to: replySuggestion.to, confidence: replySuggestion.confidence, at: replySuggestion.at },
        };
      }
  }
