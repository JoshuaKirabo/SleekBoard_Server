// Project ids are 6 to 30 lowercase letters, digits or hyphens, starting with a letter and not ending in a hyphen.
const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

// What the switch points at, read once when the function starts. A missing or mistyped setting stops the start, so
// the deploy fails where you can see it instead of the switch sitting there broken until the day the budget runs out.
export class KillSwitchSettings
  {
    constructor({ env = process.env } = {})
      {
        this.env = env;
      }

    // Set by hand on every deploy and never guessed, so the only project this can ever turn off is the one named here.
    projectId()
      {
        const id = this.read("GOOGLE_CLOUD_PROJECT");
        if(!id) throw new Error("GOOGLE_CLOUD_PROJECT has to be set to the project whose billing this switch turns off.");
        if(!PROJECT_ID.test(id)) throw new Error(`GOOGLE_CLOUD_PROJECT doesn't look like a project id. It's "${id}".`);
        return id;
      }

    // The budget this switch listens to. Any other budget publishing to the same topic (one covering the whole billing
    // account, say) can't turn this project off.
    budgetId()
      {
        const id = this.read("BUDGET_ID");
        if(!id) throw new Error("BUDGET_ID has to be set to the id of the SleekBoard budget (the part after budgets/).");
        if(id.includes("/")) throw new Error(`BUDGET_ID takes just the id, the part after budgets/. It's "${id}".`);
        return id;
      }

    // Google's Python version of this function starts in a pretend mode until it's been tried with a test budget.
    // Here it's the other way round: on unless SIMULATE_DEACTIVATION=true, so a forgotten flag can't leave the switch
    // doing nothing.
    isSimulated()
      {
        const value = this.read("SIMULATE_DEACTIVATION");
        if(value === "") return false;
        if(value === "true") return true;
        throw new Error(`SIMULATE_DEACTIVATION only takes "true", or leave it unset. It's "${value}".`);
      }

    read(name)
      {
        return String(this.env[name] ?? "").trim();
      }
  }
