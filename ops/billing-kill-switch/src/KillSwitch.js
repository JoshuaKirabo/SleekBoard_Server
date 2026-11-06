// Adapted from Google's "Disable billing usage with notifications" Node.js sample (stopBilling,
// GoogleCloudPlatform/nodejs-docs-samples functions/billing/index.js, Copyright 2019 Google LLC, Apache-2.0).
// Same steps: read the budget message, do nothing up to the budget, check billing isn't already off, then unlink the
// project from its billing account. Changed for SleekBoard: split into small classes, a message that can't be read or
// comes from another budget does nothing, and SIMULATE_DEACTIVATION from Google's Python version.
import { BudgetNotice } from "./BudgetNotice.js";

export class KillSwitch
  {
    // billing is a CloudBillingClient from @google-cloud/billing (a stand-in in the tests).
    constructor({ billing, settings, log })
      {
        this.billing = billing;
        this.log = log;
        this.projectName = `projects/${settings.projectId()}`;
        this.budgetId = settings.budgetId();
        this.simulated = settings.isSimulated();
      }

    async handle(cloudEvent)
      {
        const notice = this.noticeFrom(cloudEvent);
        if(!notice) return "unreadable";
        if(!notice.isFrom(this.budgetId)) return this.skipOtherBudget(notice);
        if(!notice.isOverBudget()) return this.stayOn(notice);
        if(!(await this.isBillingOn())) return this.alreadyOff();
        return this.simulated ? this.pretendOff(notice) : this.turnOff(notice);
      }

    // The function is deployed without --retry and the budget sends a fresh message in a few hours anyway, so a bad
    // one is logged and dropped instead of thrown.
    noticeFrom(cloudEvent)
      {
        try
          {
            return BudgetNotice.read(cloudEvent);
          }
        catch(error)
          {
            this.log.error(`Skipped a budget message I couldn't read: ${error.message}.`);
            return null;
          }
      }

    // Logged as an error since it usually means BUDGET_ID is wrong, and then the real budget's messages are skipped too.
    skipOtherBudget(notice)
      {
        this.log.error(`Skipped a message from budget "${notice.budgetId}", this switch listens to "${this.budgetId}".`);
        return "other-budget";
      }

    stayOn(notice)
      {
        this.log.info(`Under budget (${notice.describe()}), billing stays on for ${this.projectName}.`);
        return "under-budget";
      }

    alreadyOff()
      {
        this.log.info(`Over budget, but billing is already off for ${this.projectName}.`);
        return "already-off";
      }

    // Like Google's sample: if the lookup fails, assume billing is on and go ahead, so a hiccup can't stop the switch.
    async isBillingOn()
      {
        try
          {
            const [info] = await this.billing.getProjectBillingInfo({ name: this.projectName });
            return Boolean(info?.billingEnabled);
          }
        catch(error)
          {
            this.log.error(`Couldn't tell if billing is on for ${this.projectName}, assuming it is: ${error.message}`);
            return true;
          }
      }

    pretendOff(notice)
      {
        this.log.critical(`Over budget (${notice.describe()}). Would have turned billing off for ${this.projectName} (SIMULATE_DEACTIVATION=true).`);
        return "simulated";
      }

    // An empty billing account name unlinks the project, which is what turning billing off is. Google's Node sample
    // still sends it as `resource`, an old field name the current client doesn't have; projectBillingInfo is the
    // field in @google-cloud/billing's UpdateProjectBillingInfoRequest. A failure here is thrown so it shows as an
    // error in the logs, and the next budget message tries again.
    async turnOff(notice)
      {
        await this.billing.updateProjectBillingInfo({ name: this.projectName, projectBillingInfo: { billingAccountName: "" } });
        this.log.critical(`Over budget (${notice.describe()}). Turned billing off for ${this.projectName}.`);
        return "turned-off";
      }
  }
