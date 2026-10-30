// What an "email" run is: one check of your inbox for replies (services/email/ReplyCheck). No agent, the check does
// its own work, so it only asks the AI about the replies its phrase lists can't settle. Started by the MailTimer, not a
// button, and like JobNavigator's tracked "email_check" run it leaves a record of what it did.
//
// tokens is whatever hands over Gmail's access token. Until you connect Gmail it has none and the run does nothing.
export class EmailTask
  {
    constructor({ check, tokens })
      {
        this.check = check;
        this.tokens = tokens;
        // Five AI reads at about $0.0002 each. The budget is held against the day's limit while a check runs, so it's
        // kept small.
        this.maxUsd = 0.02;
      }

    async start(run, { log, signal, budget })
      {
        return { perform: () => this.perform({ log, signal, budget }) };
      }

    async perform({ log, signal, budget })
      {
        const token = await this.tokens.access(signal);
        if(!token) return { skipped: "Gmail isn't connected." };
        try
          {
            return await this.check.run({ token, log, budget, signal });
          }
        catch(error)
          {
            // Gmail turned the token down. The next check gets a fresh one, or finds out the login's dead.
            if(error.status === 401) this.tokens.drop();
            throw error;
          }
      }
  }
