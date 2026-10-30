// One run's record, and only that run's. The agent gets this instead of the whole store, so it can write its own log
// but can't touch anybody else's.
export class RunLog
  {
    constructor({ store, runId })
      {
        this.store = store;
        this.runId = runId;
      }

    start()
      {
        return this.store.markRunning(this.runId);
      }

    addStep(type, text)
      {
        return this.store.addStep(this.runId, { type, text, at: new Date() });
      }

    // The model sets the price, so the cost gets worked out here from whichever rung answered.
    addUsage(model, tokens)
      {
        return this.store.addUsage(this.runId, { model: model.id, input: tokens.input, output: tokens.output, cost: model.costOf(tokens) });
      }

    // A paid tool's bill goes in the same list as the model's, so the run's cost and the daily cap count both.
    addToolCost(tool, cost)
      {
        return this.store.addUsage(this.runId, { tool, cost });
      }

    finish(result)
      {
        return this.store.finish(this.runId, result);
      }

    fail(error)
      {
        return this.store.fail(this.runId, error.message);
      }
  }
