// One email check: search the inbox, read each new reply, and move, note or suggest on its card. Ported from
// JobNavigator's email_monitor/gmail_client.py (check_emails). Same flow: auto-replies are skipped, phrases that are
// sure act on their own, the rest go to the AI, 5 at most per check with a 2 second gap.
//
// Fixes to theirs, each a way they lost a reply for good:
//   - A failed AI read is tried again later. Theirs marked it handled.
//   - A sure reply with no card to match is tried again later, so a reply that lands before you add the job still
//     counts once you do. Theirs marked it handled.
//   - The first check reads back 90 days (AutoJob's first look), later ones 3. Theirs only ever read 3, so a server
//     that was off for longer missed replies.
//   - A card that moved between reading and writing, a message Gmail won't open, or the AI reads running out all
//     wait for the next check instead of being dropped.
// Anything tried again ages out on its own once it's older than the 3 days a check reads.
//
// Ours checks every minute, theirs every 30 (Josh wants a card to move as soon as the reply lands). So "tried again
// later" means the reply rests for 10 minutes first, or a reply with no card would start a check every minute.
//
// JobNavigator is MIT licensed: Copyright (c) 2026 JobNavigator Contributors.
// https://github.com/vesaias/JobNavigator/blob/main/backend/email_monitor/gmail_client.py

export const FIRST_LOOK_DAYS = 90;
export const DAYS = 3;

// The most ids one check lists. Gmail's single page.
const MOST = 500;

const AI_PER_CHECK = 5;
const AI_GAP_MS = 2_000;

// How long a reply that couldn't be handled rests before the next try.
export const REST_MS = 10 * 60_000;

// What can happen to one reply. "left" wasn't handled and rests before another try. "deferred" is tried at the next
// check.
export const OUTCOMES = ["moved", "noted", "suggested", "ignored", "left", "deferred"];

const LANE_NAMES = { saved: "Saved", applied: "Applied", interviewing: "Interviewing", offer: "Offer", rejected: "Rejected", ghosted: "Ghosted" };

export class ReplyCheck
  {
    constructor({ gmail, search, reader, mailbox, jobs, sorter, match, ai, lanes, desk, aiPerCheck = AI_PER_CHECK, aiGapMs = AI_GAP_MS, sleep, now = () => Date.now() })
      {
        this.gmail = gmail;
        this.search = search;
        this.reader = reader;
        this.mailbox = mailbox;
        this.jobs = jobs;
        this.sorter = sorter;
        this.match = match;
        this.ai = ai;
        this.lanes = lanes;
        this.desk = desk;
        this.aiPerCheck = aiPerCheck;
        this.aiGapMs = aiGapMs;
        this.sleep = sleep || ((ms, signal) => new Promise((resolve) => setTimeout(resolve, ms, signal)));
        this.now = now;
      }

    // Runs one check with an access token. Gives back a count of each outcome. The run's { log, budget, signal } bill
    // the AI and stop the check when the run's time is up; every reply handled so far stays handled.
    async run({ token, log, budget, signal })
      {
        const { days, found, due, resting } = await this.inbox(token, signal);
        const state = { token, log, budget, signal, aiLeft: this.aiPerCheck, aiUsed: 0, waiting: await this.waitingJobs() };
        const tally = Object.fromEntries(OUTCOMES.map((outcome) => [outcome, 0]));
        for(const id of due)
          {
            signal?.throwIfAborted();
            const outcome = await this.handleId(id, state);
            tally[outcome]++;
            await this.keep(id, outcome);
          }
        // Replies with no card don't hold up the first look: a 60 day old rejection from a company you never added
        // doesn't matter. Only replies it ran out of time or AI reads for do.
        await this.mailbox.checked(tally.deferred === 0);
        await log?.addStep("message", this.summaryOf(days, found, tally));
        return { days, found, resting, ...tally };
      }

    // True when the inbox has a reply due right now. The timer asks before starting a run, so a minute with nothing new
    // costs one Gmail call and leaves no run behind.
    async hasNew(token, signal)
      {
        return (await this.inbox(token, signal)).due.length > 0;
      }

    // What the search finds, and which of those are due: not handled yet and not resting.
    async inbox(token, signal)
      {
        const box = await this.mailbox.get();
        const days = box.caughtUp ? DAYS : FIRST_LOOK_DAYS;
        const ids = await this.gmail.ids(token, this.search.query(days), { most: MOST, signal });
        const handled = new Set(box.processed);
        const resting = this.restingIds(box);
        const due = ids.filter((id) => !handled.has(id) && !resting.has(id));
        return { days, found: ids.length, due, resting: ids.filter((id) => resting.has(id)).length };
      }

    // Replies tried within the last 10 minutes.
    restingIds(box)
      {
        const since = this.now() - REST_MS;
        return new Set((box.resting || []).filter((one) => new Date(one.at).getTime() > since).map((one) => one.id));
      }

    // Writes down what happened to a reply: handled, resting, or nothing at all for one the next check picks up.
    keep(id, outcome)
      {
        if(outcome === "left") return this.mailbox.leave(id);
        if(outcome === "deferred") return null;
        return this.mailbox.remember(id);
      }

    // The cards a reply can still move, read once a check and kept up to date as cards move.
    async waitingJobs()
      {
        return this.jobs.find({ status: { $in: this.lanes.waitingLanes() } });
      }

    // Opens one message and handles it. One Gmail can't open waits for the next check, like theirs.
    async handleId(id, state)
      {
        let message;
        try
          {
            message = await this.gmail.message(state.token, id, state.signal);
          }
        catch(error)
          {
            if(state.signal?.aborted) throw error;
            return "deferred";
          }
        return this.handle(this.reader.read(message), state);
      }

    async handle(email, state)
      {
        const verdict = this.sorter.sort(email.subject, email.body);
        if(verdict.kind === "auto_reply") return "ignored";
        if(this.sorter.sure(verdict)) return this.byPhrases(email, verdict, state);
        return this.byAi(email, state);
      }

    // Sure from the phrases alone. No card to match means it's tried again, in case you add the job.
    async byPhrases(email, verdict, state)
      {
        const job = this.match.jobFor(email, state.waiting);
        if(!job) return "left";
        return this.apply(job, this.lanes.afterPhrases(job.status, verdict.kind), email, state);
      }

    // Unclear, so the AI reads it, while this check still has AI reads left.
    async byAi(email, state)
      {
        if(state.aiLeft <= 0) return "deferred";
        const answer = await this.askAi(email, state);
        if(!answer) return "left";
        if(this.ai.acts(answer, email)) return this.apply(answer.job, this.lanes.afterAi(answer.job.status, answer.status), email, state);
        if(this.ai.suggests(answer, email)) return this.suggest(answer, email, state);
        return "ignored";
      }

    // One AI read, after the gap if it isn't the first. null when it fails, unless the run itself has stopped.
    async askAi(email, state)
      {
        if(state.aiUsed > 0) await this.sleep(this.aiGapMs);
        state.aiLeft--;
        state.aiUsed++;
        try
          {
            return await this.ai.read(email, state.waiting, { log: state.log, budget: state.budget, signal: state.signal });
          }
        catch(error)
          {
            if(state.signal?.aborted) throw error;
            return null;
          }
      }

    // Moves the card when there's a lane to move to, or just keeps the reply on it. A card that moved meanwhile waits
    // for the next check.
    async apply(job, lane, email, state)
      {
        if(!lane)
          {
            this.refresh(state, await this.desk.note(job, email));
            return "noted";
          }
        const moved = await this.desk.move(job, lane, email);
        if(!moved) return "deferred";
        this.refresh(state, moved);
        await state.log?.addStep("message", `Moved ${job.company} to ${LANE_NAMES[lane]} from a reply.`);
        return "moved";
      }

    // Only a step forward is worth suggesting.
    async suggest(answer, email, state)
      {
        const lane = this.lanes.afterAi(answer.job.status, answer.status);
        if(!lane) return "ignored";
        this.refresh(state, await this.desk.suggest(answer.job, lane, answer.confidence, email));
        await state.log?.addStep("message", `Suggested moving ${answer.job.company} to ${LANE_NAMES[lane]}.`);
        return "suggested";
      }

    // Swaps in the card as it is now, or drops it once it's no longer waiting on a reply.
    refresh(state, job)
      {
        if(!job) return;
        const others = state.waiting.filter((one) => String(one._id) !== String(job._id));
        state.waiting = this.lanes.waiting(job.status) ? [...others, job] : others;
      }

    // One line for the run's log. Counts only, never what an email said.
    summaryOf(days, found, tally)
      {
        const parts = OUTCOMES.filter((outcome) => tally[outcome]).map((outcome) => `${tally[outcome]} ${outcome}`);
        return `Checked ${days} days of replies: ${found} found${parts.length ? `, ${parts.join(", ")}` : ""}.`;
      }
  }
