import OpenAI from "openai";
import { Run } from "../models/run.model.js";
import { MODELS } from "./models.js";
import { Model } from "./Model.js";
import { ModelLadder } from "./ModelLadder.js";
import { AiClient } from "./AiClient.js";
import { Toolbox } from "./Toolbox.js";
import { Agent } from "./Agent.js";
import { RunStore } from "./RunStore.js";
import { RunLog } from "./RunLog.js";
import { SpendingCap } from "./SpendingCap.js";
import { Runner } from "./Runner.js";

// The one place that builds the real thing. Every class above gets what it needs through its constructor, and this
// file is where those pieces meet, like Spring's wiring without Spring. Tests skip this file and build their own.

const TOGETHER_URL = "https://api.together.xyz/v1";

export const runStore = new RunStore(Run);
export const ladder = new ModelLadder(MODELS.map((settings) => new Model(settings)));

// Built when a run starts, not when the server boots, so the server still starts without a key and only AI runs
// complain about it.
const clientFor = (model) =>
  {
    if(!process.env.TOGETHER_API_KEY) throw new Error("TOGETHER_API_KEY is missing from .env.");
    // 45 seconds per reply and one retry when Together hiccups. Every model we tried answered a whole test run in 1.5
    // to 12 seconds, so that's plenty, and the run's own 3 minutes still caps it all.
    const sdk = new OpenAI({ apiKey: process.env.TOGETHER_API_KEY, baseURL: TOGETHER_URL, timeout: 45_000, maxRetries: 1 });
    return new AiClient({ sdk, model });
  };

// A task says where it starts on the ladder, what the model has to be able to do, and which tools it gets.
// The signal is the run's deadline, so the agent stops when the run's time is up.
const buildAgent = ({ task, log, signal }) =>
  {
    const model = ladder.pick(task.rung, task.ability);
    return new Agent({ ai: clientFor(model), toolbox: new Toolbox(task.tools), log, maxSteps: task.maxSteps, signal });
  };

const logFor = (runId) => new RunLog({ store: runStore, runId });

// 20 runs and a dollar a day unless .env says otherwise. A contact search costs about 1 to 2 cents. Setting either
// to 0 switches AI runs off.
const cap = new SpendingCap({ store: runStore, maxRuns: Number(process.env.AI_DAILY_RUNS ?? 20), maxUsd: Number(process.env.AI_DAILY_USD ?? 1) });

// Empty until piece 3 adds the contact finder.
const tasks = new Map();

export const runner = new Runner({ store: runStore, cap, tasks, buildAgent, logFor });
