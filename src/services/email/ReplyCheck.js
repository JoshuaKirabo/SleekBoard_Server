// One email check: search the inbox, read each new reply, and move, note or suggest on its card. Ported from
// JobNavigator's email_monitor/gmail_client.py (check_emails). Same flow: auto-replies are skipped, phrases that are
// sure act on their own, the rest go to the AI, 5 at most per check with a 2 second gap.
//
// Fixes to theirs, each a way they lost a reply for good:
//   - A failed AI read is tried again next check. Theirs marked it handled.
//   - A sure reply with no card to match is tried again next check, so a reply that lands before you add the job
//     still counts once you do. Theirs marked it handled.
//   - The first check reads back 90 days (AutoJob's first look), later ones 3. Theirs only ever read 3, so a server
//     that was off for longer missed replies.
//   - A card that moved between reading and writing is left for next check, not dropped.
// Anything tried again ages out on its own once it's older than the 3 days a check reads.
//
// JobNavigator is MIT licensed: Copyright (c) 2026 JobNavigator Contributors.
// https://github.com/vesaias/JobNavigator/blob/main/backend/email_monitor/gmail_client.py

export const FIRST_LOOK_DAYS = 90;
export const DAYS = 3;

// The most ids one check lists. Gmail's single page.
const MOST = 500;

const AI_PER_CHECK = 5;
const AI_GAP_MS = 2_000;

// What can happen to one reply. "left" means it wasn't handled and the next check tries it again.
export const OUTCOMES = ["moved", "noted", "suggested", "ignored", "left"];

const LANE_NAMES = { saved: "Saved", applied: "Applied", interviewing: "Interviewing", offer: "Offer", rejected: "Rejected", ghosted: "Ghosted" };

export class ReplyCheck
  {
    constructor({ gmail, search, reader, mailbox, jobs, sorter, match, ai, lanes, desk, aiPerCheck = AI_PER_CHECK, aiGapMs = AI_GAP_MS, sleep })
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
      }

    // Runs one check with an access token. Gives back a count of each outcome. The run's { log, budget, signal } bill
    // the AI and stop the check when the run's time is up; every reply handled so far stays handled.
    async run({ token, log, budget, signal })
      {
        const box = await this.mailbox.get();
        const days = box.caughtUp ? DAYS : FIRST_LOOK_DAYS;
        const ids = await this.gmail.ids(token, this.search.query(days), { most: MOST, signal });
        const seen = new Set(box.processed);
        const state = { token, log, budget, signal, aiLeft: this.aiPerCheck, aiUsed: 0, waiting: await this.waitingJobs() };
        const tally = Object.fromEntries(OUTCOMES.map((outcome) => [outcome, 0]));
        for(const id of ids.filter((id) => !seen.has(id)))
          {
            signal?.throwIfAborted();
            const outcome = await this.handleId(id, state);
            tally[outcome]++;
            if(outcome !== "left") await this.mailbox.remember(id);
          }
        await this.mailbox.checked(tally.left === 0);
        await log?.addStep("message", this.summaryOf(days, ids.length, tally));
        return { days, found: ids.length, ...tally };
      }

    // The cards a reply can still move, read once a check and kept up to date as cards move.
    async waitingJobs()
      {
        return this.jobs.find({ status: { $in: this.lanes.waitingLanes() } });
      }

    // Opens one message and handles it. One Gmail can't open is tried again next check, like theirs.
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
            return "left";
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
        if(state.aiLeft <= 0) return "left";
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

    // Moves the card when there's a lane to move to, or just keeps the reply on it. A card that moved meanwhile is
    // tried again next check.
    async apply(job, lane, email, state)
      {
        if(!lane)
          {
            this.refresh(state, await this.desk.note(job, email));
            return "noted";
          }
        const moved = await this.desk.move(job, lane, email);
        if(!moved) return "left";
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
