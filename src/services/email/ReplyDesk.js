import { StatusCodes } from "http-status-codes";

export const DECISIONS = ["accept", "dismiss"];

const failure = (status, message) => Object.assign(new Error(message), { status });

// How much of a reply is kept on the card. JobNavigator's 200.
const SNIPPET = 200;

// Writing what a reply means onto its card. Moving it and keeping the snippet come from JobNavigator's
// email_monitor/gmail_client.py (_apply_email_to_app). The suggestion is career-ops' approval idea (modes/reply-watch.md):
// an unsure reply never moves anything until you say yes.
//
// JobNavigator is MIT licensed: Copyright (c) 2026 JobNavigator Contributors.
// https://github.com/vesaias/JobNavigator/blob/main/backend/email_monitor/gmail_client.py
export class ReplyDesk
  {
    constructor({ Job, history, lanes })
      {
        this.Job = Job;
        this.history = history;
        this.lanes = lanes;
      }

    // The start of the reply, or of its subject when the body's empty, on one line.
    snippetOf(email)
      {
        const text = String(email.body || "").trim() ? email.body : email.subject;
        return String(text || "").replace(/\s+/g, " ").trim().slice(0, SNIPPET);
      }

    // The reply's fields as they're saved on the card.
    replyOf(email)
      {
        return { replyAt: new Date(), replySnippet: this.snippetOf(email) };
      }

    // Moves the card for a reply and keeps the reply on it. null if the card moved in the meantime.
    move(job, lane, email)
      {
        return this.history.move(job, lane, "email", this.replyOf(email));
      }

    // Keeps the reply on the card without moving it, like a "can you do Tuesday?" on a card already in Interviewing.
    note(job, email)
      {
        return this.Job.findByIdAndUpdate(job._id, this.replyOf(email), { new: true });
      }

    // Leaves the AI's guess on the card for you to answer, with the reply it came from.
    suggest(job, lane, confidence, email)
      {
        const replySuggestion = { to: lane, confidence, at: new Date() };
        return this.Job.findByIdAndUpdate(job._id, { ...this.replyOf(email), replySuggestion }, { new: true, runValidators: true });
      }

    // Your answer to a suggestion. Accept moves the card as an email move, so Undo works on it like any other. Dismiss
    // just clears it.
    async decide(jobId, decision)
      {
        if(!DECISIONS.includes(decision)) throw failure(StatusCodes.BAD_REQUEST, `decision has to be ${DECISIONS.join(" or ")}.`);
        const job = await this.Job.findById(jobId);
        if(!job) throw failure(StatusCodes.NOT_FOUND, "That job doesn't exist.");
        if(!job.replySuggestion) throw failure(StatusCodes.CONFLICT, "That card has no suggestion to answer.");
        if(decision === "dismiss") return this.clear(job);
        return this.accept(job);
      }

    // Moves the card where the suggestion said, as long as that's still a step forward.
    async accept(job)
      {
        const to = this.lanes.forward(job.status, job.replySuggestion.to);
        if(!to)
          {
            await this.clear(job);
            throw failure(StatusCodes.CONFLICT, "That card has moved on since, so the suggestion was cleared.");
          }
        const moved = await this.history.move(job, to, "email");
        if(!moved) throw failure(StatusCodes.CONFLICT, "That card just moved. Refresh and try again.");
        return moved;
      }

    clear(job)
      {
        return this.Job.findByIdAndUpdate(job._id, { replySuggestion: null }, { new: true });
      }
  }
