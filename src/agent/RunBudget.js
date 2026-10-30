// What one run may spend. The agent charges every reply to it and asks it before each trip to the model, so a run
// that keeps resending long pages stops itself instead of draining the day. The check comes before the trip, so the
// reply that crosses the line still lands: a run can go over by one reply, never by more. The agent checks again before
// running that reply's tools, so the reply over the line can't add paid searches on top.
export class RunBudget
  {
    constructor(maxUsd)
      {
        this.maxUsd = maxUsd;
        this.spent = 0;
      }

    charge(cost)
      {
        this.spent += cost;
      }

    // Throws once the run has used its share, and does nothing while there's some left.
    ensureRoom()
      {
        if(this.spent >= this.maxUsd) throw new Error(`This run used its $${this.maxUsd.toFixed(2)} budget.`);
      }
  }
