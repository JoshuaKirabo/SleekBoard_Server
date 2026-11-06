// One budget notification off Pub/Sub. Google's budget sends these several times a day: the attributes say which
// budget it's from (budgetId), the data is base64 JSON with costAmount and budgetAmount in the budget's currency.
// Format: docs.cloud.google.com/billing/docs/how-to/budgets-programmatic-notifications
export class BudgetNotice
  {
    constructor({ budgetId, costAmount, budgetAmount })
      {
        this.budgetId = budgetId;
        this.costAmount = costAmount;
        this.budgetAmount = budgetAmount;
      }

    // The function is registered as a CloudEvent one, so the Pub/Sub message sits at data.message, the same place
    // Google's Python version of this function and their Node Pub/Sub sample read it from.
    static read(cloudEvent)
      {
        const message = cloudEvent?.data?.message;
        if(!message) throw new Error("no Pub/Sub message in the event");
        const data = BudgetNotice.decode(message.data);
        const budgetId = message.attributes?.budgetId ?? "";
        const costAmount = BudgetNotice.amount(data.costAmount, "costAmount");
        const budgetAmount = BudgetNotice.amount(data.budgetAmount, "budgetAmount");
        return new BudgetNotice({ budgetId, costAmount, budgetAmount });
      }

    static decode(data)
      {
        if(typeof data !== "string" || !data) throw new Error("the message has no data");
        const parsed = BudgetNotice.parse(Buffer.from(data, "base64").toString());
        if(!parsed || typeof parsed !== "object") throw new Error("the message data isn't a JSON object");
        return parsed;
      }

    static parse(text)
      {
        try
          {
            return JSON.parse(text);
          }
        catch
          {
            throw new Error("the message data isn't base64 JSON");
          }
      }

    // Google's sample compares whatever comes in, and a missing amount compares false both ways, so a message without
    // them would have turned billing off. Only real numbers get through here.
    static amount(value, name)
      {
        if(typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${name} isn't a number`);
        return value;
      }

    isFrom(budgetId)
      {
        return this.budgetId === budgetId;
      }

    // Same line Google's sample draws: costs up to the budget are fine, anything past it turns billing off.
    isOverBudget()
      {
        return this.costAmount > this.budgetAmount;
      }

    describe()
      {
        return `${this.costAmount} of ${this.budgetAmount}`;
      }
  }
