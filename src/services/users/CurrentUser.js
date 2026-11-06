import { AsyncLocalStorage } from "node:async_hooks";
import { StatusCodes } from "http-status-codes";

// Whose data the server is working on right now. Each signed-in request runs as its person (requireUser), and so does
// background work started for them: a run carries who started it, and the email check takes each mailbox's owner in
// turn. Every store asks id() before it reads or writes, so a query can't go out without an owner.
//
// Node's AsyncLocalStorage keeps the user with the work as it awaits, the way a request-scoped bean would in Spring,
// so the stores don't need a user passed through every method.
export class CurrentUser
  {
    constructor()
      {
        this.storage = new AsyncLocalStorage();
      }

    // Runs work as this user. Anything it starts, awaited or not, stays theirs.
    as(userId, work)
      {
        return this.storage.run({ userId }, work);
      }

    // The user's id, or null when nobody's set.
    current()
      {
        return this.storage.getStore()?.userId || null;
      }

    // The user's id, for a store about to touch their rows. Throws a 401 rather than guess.
    id()
      {
        const userId = this.current();
        if(!userId) throw Object.assign(new Error("Not signed in."), { status: StatusCodes.UNAUTHORIZED });
        return userId;
      }
  }
