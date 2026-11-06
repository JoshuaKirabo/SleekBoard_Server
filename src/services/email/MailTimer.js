// Starts an email check every so often, like JobNavigator's scheduler (run_email_check every
// email_check_interval_minutes, 30 by default). Ours ticks every minute so a card moves soon after the reply lands
// (Josh, 2026-10-30), and a tick only starts a run when Gmail has a reply due, so quiet minutes leave nothing behind.
// Never two at once, the way their tracked run refuses to start while the last one's still going. Nothing starts while
// Gmail isn't connected.
//
// Once SleekBoard is deployed, Gmail's push notifications can start a check the second a reply lands. This stays as
// the backup.
//
// Every mailbox gets its own check, as its owner (people, a CurrentUser), since nobody's signed in when the clock
// ticks. mailboxes.owners() says whose to check; tests that don't care about users leave both out.
//
// It lives in the server's memory, so a restart starts the clock over. FEATURES.md's reliable scheduler, kept in Mongo,
// replaces it before the server runs anywhere but this Mac.
// For a timer with no users: one mailbox, nobody's in particular, and work runs as it is.
const ANYONE = { current: () => null, as: (userId, work) => work() };
const JUST_ONE = { owners: async () => [null] };

export class MailTimer
  {
    constructor({ runner, store, tokens, check, everyMs, people = ANYONE, mailboxes = JUST_ONE })
      {
        this.runner = runner;
        this.store = store;
        this.tokens = tokens;
        this.check = check;
        this.everyMs = everyMs;
        this.people = people;
        this.mailboxes = mailboxes;
        // The last check started for each owner, so one person's slow check doesn't hold up anyone else's.
        this.lastRuns = new Map();
        this.timer = null;
      }

    // A round now, then one every everyMs. unref() so the timer alone doesn't keep the process alive.
    start()
      {
        this.round();
        this.timer = setInterval(() => this.round(), this.everyMs);
        this.timer.unref?.();
      }

    // One tick for each mailbox, as its owner, one after another. A list that can't be read is logged and tried again
    // next time.
    async round()
      {
        try
          {
            for(const userId of await this.mailboxes.owners()) await this.people.as(userId, () => this.tick());
          }
        catch(error)
          {
            console.warn("The email check couldn't list mailboxes:", error.message);
          }
      }

    stop()
      {
        clearInterval(this.timer);
        this.timer = null;
      }

    // Starts a check unless Gmail isn't connected, the last one's still going, or nothing's due. A full day's budget, or
    // anything else going wrong, is logged and tried again next time.
    async tick()
      {
        try
          {
            if(!(await this.tokens.connected())) return null;
            if(await this.busy()) return null;
            if(!(await this.due())) return null;
            const run = await this.runner.submit("email");
            this.lastRuns.set(this.people.current(), run.id);
            return run;
          }
        catch(error)
          {
            console.warn("The email check didn't start:", error.message);
            return null;
          }
      }

    // True when Gmail has a reply the check would read now.
    async due()
      {
        const token = await this.tokens.access();
        if(!token) return false;
        try
          {
            return await this.check.hasNew(token);
          }
        catch(error)
          {
            if(error.status === 401) this.tokens.drop();
            throw error;
          }
      }

    // True while the last check this timer started for this owner is queued or running.
    async busy()
      {
        const lastRun = this.lastRuns.get(this.people.current());
        if(!lastRun) return false;
        const run = await this.store.find(lastRun);
        return Boolean(run) && ["queued", "running"].includes(run.status);
      }
  }
