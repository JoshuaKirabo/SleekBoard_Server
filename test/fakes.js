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

// An SDK that streams scripted chunks, one script per request, and keeps every request it was sent. A script can
// also be a function that gets the request's signal and returns its own stream, for a reply that stalls.
export class StreamingSdk
  {
    constructor(scripts)
      {
        this.scripts = [...scripts];
        this.requests = [];
        this.signals = [];
        this.chat = { completions: { create: (body, options) => this.create(body, options) } };
      }

    async create(body, { signal } = {})
      {
        this.requests.push(structuredClone(body));
        this.signals.push(signal);
        const script = this.scripts.shift();
        if(!script) throw new Error("The script ran out of replies.");
        return typeof script === "function" ? script(signal) : this.play(script);
      }

    async *play(chunks)
      {
        for(const chunk of chunks) yield chunk;
      }
  }

// One streamed chunk carrying a bit of the reply, the way Together sends it.
export const chunk = (delta) => ({ choices: [{ index: 0, delta }] });

// The last chunk, with nothing but the usage.
export const usageChunk = (input, output) => ({ choices: [], usage: { prompt_tokens: input, completion_tokens: output } });

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

    async addToolCost(tool, cost)
      {
        this.usage.push({ tool, cost });
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

    async create({ kind, job, budget, input })
      {
        const run = { id: `run-${this.runs.length + 1}`, kind, job, budget, input, status: "queued", cost: 0, createdAt: new Date() };
        this.runs.push(run);
        return run;
      }

    // Same rule as RunStore: email checks don't count as runs.
    async countSince(date)
      {
        return this.runs.filter((run) => run.createdAt >= date && run.kind !== "email").length;
      }

    // Same rule as RunStore: a run that hasn't ended counts as its whole budget, or what it's spent if that's more.
    async costSince(date)
      {
        return this.runs.filter((run) => run.createdAt >= date).reduce((total, run) => total + this.held(run), 0);
      }

    held(run)
      {
        const live = ["queued", "running"].includes(run.status);
        return live ? Math.max(run.cost, run.budget || 0) : run.cost;
      }
  }

// A fetch that answers from a script, one answer per request, and keeps every request it was sent. An answer can be a
// function that gets the request's signal, for a server that never answers.
export class FakeFetch
  {
    constructor(answers)
      {
        this.answers = [...answers];
        this.requests = [];
        this.fetch = (url, options) => this.answer(url, options);
      }

    async answer(url, options = {})
      {
        this.requests.push({ url, ...options, body: options.body && JSON.parse(options.body) });
        const answer = this.answers.shift();
        if(!answer) throw new Error("The script ran out of answers.");
        return typeof answer === "function" ? answer(options.signal) : answer;
      }
  }

// A JSON answer the way Exa sends one.
export const jsonResponse = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// The Job model's update calls, over plain objects in memory. It understands only the filters and operators the lane
// history, the reply desk and the email check use: _id, status and moves.$size, then $set, $push and $pop.
export class MemoryJobs
  {
    constructor(jobs = [])
      {
        this.jobs = new Map(jobs.map((job) => [job._id, { moves: [], replySuggestion: null, ...structuredClone(job) }]));
      }

    async findById(id)
      {
        const job = this.jobs.get(id);
        return job ? structuredClone(job) : null;
      }

    // Only { status: { $in: [...] } }, what the email check asks for.
    async find(filter = {})
      {
        const lanes = filter.status?.$in;
        return [...this.jobs.values()].filter((job) => !lanes || lanes.includes(job.status)).map((job) => structuredClone(job));
      }

    async findOneAndUpdate(filter, update)
      {
        const job = this.jobs.get(filter._id);
        if(!job || !this.fits(job, filter)) return null;
        Object.assign(job, update.$set || {});
        for(const [key, value] of Object.entries(update.$push || {})) job[key].push(value);
        for(const key of Object.keys(update.$pop || {})) job[key].pop();
        return structuredClone(job);
      }

    async findByIdAndUpdate(id, fields)
      {
        const job = this.jobs.get(id);
        if(!job) return null;
        Object.assign(job, fields);
        return structuredClone(job);
      }

    fits(job, filter)
      {
        if("status" in filter && job.status !== filter.status) return false;
        if(filter.moves && job.moves.length !== filter.moves.$size) return false;
        return true;
      }

    // Moves a card behind the code's back, like a drag landing in between a read and a write.
    sneak(id, status)
      {
        this.jobs.get(id).status = status;
      }
  }
