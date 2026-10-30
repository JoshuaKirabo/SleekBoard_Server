// Every model we can use, cheapest first. It only picks models; it never talks to one.
export class ModelLadder
  {
    constructor(models)
      {
        this.models = [...models].sort((a, b) => a.rung - b.rung);
      }

    // The cheapest model on this rung or higher that can do the job. A task starting on rung 2 that needs tools skips
    // anything that can't call them.
    pick(rung, ability)
      {
        const model = this.models.find((candidate) => candidate.rung >= rung && candidate.can(ability));
        if(!model) throw new Error(`No model on rung ${rung} or higher can do "${ability}".`);
        return model;
      }

    // The next model up that can do the same job, or null when we're already at the top. This is what a run climbs to
    // when a check fails.
    above(model, ability)
      {
        return this.models.find((candidate) => candidate.rung > model.rung && candidate.can(ability)) || null;
      }
  }
