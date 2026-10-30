import { Model } from "../src/agent/Model.js";

// Stand-ins the tests hand to the real classes through their constructors. Nothing here talks to Together or Mongo.

export const cheapModel = new Model({ rung: 1, name: "Cheap", id: "fake/cheap", priceIn: 1, priceOut: 2, abilities: ["tools", "json"] });

// A model that replies from a script, one reply per call, and keeps every message list it was sent so a test can
// check what the agent passed along.
export class ScriptedAi
  {
    constructor(replies, model = cheapModel)
      {
        this.replies = [...replies];
        this.model = model;
        this.calls = [];
      }

    async complete(messages, tools)
      {
        this.calls.push({ messages: structuredClone(messages), tools });
        const message = this.replies.shift();
        if(!message) throw new Error("The script ran out of replies.");
        return { message, tokens: { input: 1000, output: 100 } };
      }
  }

// A tool call the way the API sends it, arguments and all.
export const toolCall = (id, name, args) => ({ id, type: "function", function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) } });

// Collects what an agent writes so a test can read it back.
export class MemoryLog
  {
    constructor()
      {
        this.steps = [];
        this.usage = [];
        this.events = [];
      }

    async start()
      {
        this.events.push("start");
      }

    async addStep(type, text)
      {
        this.steps.push({ type, text });
      }

    async addUsage(model, tokens)
      {
        this.usage.push({ model: model.id, ...tokens, cost: model.costOf(tokens) });
      }

    async finish(result)
      {
        this.events.push("finish");
        this.result = result;
      }

    async fail(error)
      {
        this.events.push("fail");
        this.error = error.message;
      }
  }

// Just the parts of RunStore that SpendingCap and Runner use, kept in an array.
export class MemoryRunStore
  {
    constructor(runs = [])
      {
        this.runs = runs;
      }

    async create({ kind, job })
      {
        const run = { id: `run-${this.runs.length + 1}`, kind, job, cost: 0, createdAt: new Date() };
        this.runs.push(run);
        return run;
      }

    async countSince(date)
      {
        return this.runs.filter((run) => run.createdAt >= date).length;
      }

    async costSince(date)
      {
        return this.runs.filter((run) => run.createdAt >= date).reduce((total, run) => total + run.cost, 0);
      }
  }
