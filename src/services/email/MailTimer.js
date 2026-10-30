// Starts an email check every so often, like JobNavigator's scheduler (run_email_check every
// email_check_interval_minutes, 30 by default). Never two at once, the way their tracked run refuses to start while the
// last one's still going. Nothing starts while Gmail isn't connected.
//
// It lives in the server's memory, so a restart starts the clock over. FEATURES.md's reliable scheduler, kept in Mongo,
// replaces it before the server runs anywhere but this Mac.
export class MailTimer
  {
    constructor({ runner, store, tokens, everyMs })
      {
        this.runner = runner;
        this.store = store;
        this.tokens = tokens;
        this.everyMs = everyMs;
        this.lastRun = null;
        this.timer = null;
      }

    // A check now, then one every everyMs. unref() so the timer alone doesn't keep the process alive.
    start()
      {
        this.tick();
        this.timer = setInterval(() => this.tick(), this.everyMs);
        this.timer.unref?.();
      }

    stop()
      {
        clearInterval(this.timer);
        this.timer = null;
      }

    // Starts a check unless Gmail isn't connected or the last one's still going. A full day's budget, or anything else
    // going wrong, is logged and tried again next time.
    async tick()
      {
        try
          {
            if(!(await this.tokens.connected())) return null;
            if(await this.busy()) return null;
            const run = await this.runner.submit("email");
            this.lastRun = run.id;
            return run;
          }
        catch(error)
          {
            console.warn("The email check didn't start:", error.message);
            return null;
          }
      }

    // True while the last check this timer started is queued or running.
    async busy()
      {
        if(!this.lastRun) return false;
        const run = await this.store.find(this.lastRun);
        return Boolean(run) && ["queued", "running"].includes(run.status);
      }
  }
