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
import { AiLimits } from "./AiLimits.js";
import { ExaClient } from "./ExaClient.js";
import { ContactTask } from "./tasks/ContactTask.js";
import { FillTask } from "./tasks/FillTask.js";
import { NoteTask } from "./tasks/NoteTask.js";
import { Job } from "../models/job.model.js";
import { fetchPage, readJob } from "../services/jobReader.js";
import { contactBook, jobCard } from "../services/contacts/index.js";
import { SuggestionDesk } from "../services/contacts/SuggestionDesk.js";

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
    // 45 seconds for a reply to start and one retry when Together hiccups. Once it's streaming, AiClient gives it
    // another 45 seconds to finish, and the run's own 3 minutes still caps it all.
    const sdk = new OpenAI({ apiKey: process.env.TOGETHER_API_KEY, baseURL: TOGETHER_URL, timeout: 45_000, maxRetries: 1 });
    return new AiClient({ sdk, model });
  };

// A task says where it starts on the ladder and what the model has to be able to do, and its run hands over the tools.
// The signal is the run's deadline, so the agent stops when the run's time is up, and the budget stops it once the run
// has spent its share.
const buildAgent = ({ task, tools, log, signal, budget }) =>
  {
    const model = ladder.pick(task.rung, task.ability);
    return new Agent({ ai: clientFor(model), toolbox: new Toolbox(tools), log, maxSteps: task.maxSteps, signal, budget });
  };

const logFor = (runId) => new RunLog({ store: runStore, runId });

// Read and checked here, when the server boots, so a typo in .env stops the start instead of switching the cap off.
const limits = new AiLimits(process.env);

// Setting either daily limit to 0 switches AI runs off.
const cap = new SpendingCap({ store: runStore, maxRuns: limits.dailyRuns, maxUsd: limits.dailyUsd });

// A missing EXA_API_KEY doesn't stop the server. The first search fails with Exa's message to fix .env instead.
const exa = new ExaClient({ apiKey: process.env.EXA_API_KEY });

// Your schools, for finding alumni. They'll come from your profile once you can fill in your details and resume
// (Josh, 2026-10-30). Until then there are none, so the finder skips alumni and looks for teammates instead.
const schools = [];

// Every kind of run the server knows, by the kind a run is saved with.
const tasks = new Map(
  [
    ["contact", new ContactTask({ jobs: Job, exa, fetchPage, schools })],
    ["note", new NoteTask({ jobs: Job, contacts: contactBook, fetchPage })],
    ["fill", new FillTask({ readJob, exa, fetchPage, store: runStore, schools })],
  ]);

// A task can still set its own budget.
export const runner = new Runner({ store: runStore, cap, tasks, buildAgent, logFor, runUsd: limits.runUsd });

// Where you say yes or no to a run's suggestions. Built here because it reads runs.
export const suggestionDesk = new SuggestionDesk({ runs: runStore, jobs: Job, book: contactBook, card: jobCard });
