import { StatusCodes } from "http-status-codes";
import { Deadline } from "./Deadline.js";
import { Lock } from "./Lock.js";
import { RunBudget } from "./RunBudget.js";

// How long a whole run gets. Runs should take 30 to 90 seconds, so this is double the slowest.
const RUN_MS = 3 * 60_000;

// How long checking the cap and saving a new run gets. It's three quick database calls, so 10 seconds means Mongo is
// stuck.
const ADMIT_MS = 10_000;

// What one run may spend unless its task says otherwise. A contact search costs 1 to 2 cents, so this only stops a run
// that's gone wrong, like one resending long pages for 12 steps (about 10 cents on rung 2, 47 on rung 3).
export const RUN_USD = 0.1;

// Runs agents in the background. Pressing Run gets a reply straight away, and the work carries on here, two at a time
// so 80 jobs can't all fire at once and choke the database.
//
// Everything it uses gets handed in: tasks says what each kind of run does, buildAgent makes an agent for a task, and
// logFor makes one run's log. Tests swap all three for fakes.
//
// A task's start(run) gives back that run's work: brief() for the agent, tools() it may use, built fresh for the run,
// and result(answer), which turns the agent's final answer into what the run saves. A task that needs more than the
// job, like the contact a note is for, also has inputFor(input, jobId), which checks what was sent and gives back
// what the run should keep, before the run is saved or counted.
export class Runner
  {
    constructor({ store, cap, tasks, buildAgent, logFor, slots = 2, runMs = RUN_MS, admitMs = ADMIT_MS, runUsd = RUN_USD })
      {
        this.store = store;
        this.cap = cap;
        this.tasks = tasks;
        this.buildAgent = buildAgent;
        this.logFor = logFor;
        this.slots = slots;
        this.runMs = runMs;
        this.admitMs = admitMs;
        this.runUsd = runUsd;
        this.lock = new Lock();
        this.queue = [];
        this.running = new Set();
      }

    // Saves a new run and puts it in line. Gives the run back right away, while it's still queued.
    async submit(kind, jobId, input = {})
      {
        const task = this.taskFor(kind);
        const kept = await this.inputFor(task, input, jobId);
        const run = await this.lock.hold(() => new Deadline(this.admitMs, "Starting a run").race(this.admit({ kind, job: jobId, budget: this.budgetFor(task), input: kept })));
        this.enqueue({ run, task });
        return run;
      }

    // Checks the cap and saves the run with its budget. The budget goes on the run so the cap can hold it for the run
    // until it ends. It always runs under the lock, because two presses that check together both see room before
    // either has saved, and both get in. The deadline stops a stuck database call from jamming the lock for every run
    // after it.
    async admit(run)
      {
        await this.cap.check(run.budget);
        return this.store.create(run);
      }

    // A task with no inputFor takes nothing but the job.
    inputFor(task, input, jobId)
      {
        return task.inputFor ? task.inputFor(input, jobId) : undefined;
      }

    budgetFor(task)
      {
        return task.maxUsd ?? this.runUsd;
      }

    taskFor(kind)
      {
        const task = this.tasks.get(kind);
        if(!task) throw Object.assign(new Error(`There's no "${kind}" run yet.`), { status: StatusCodes.BAD_REQUEST });
        return task;
      }

    enqueue(item)
      {
        this.queue.push(item);
        this.next();
      }

    // Fills any free slots from the front of the line.
    next()
      {
        while(this.running.size < this.slots && this.queue.length) this.launch(this.queue.shift());
      }

    // Holds a slot for as long as one run takes, then hands it to whoever's next. The catch is there because a
    // promise nobody catches would crash the whole server.
    launch(item)
      {
        const work = this.execute(item)
          .catch((error) => console.error(`Run ${item.run.id} couldn't save its result:`, error.message))
          .finally(() =>
            {
              this.running.delete(work);
              this.next();
            });
        this.running.add(work);
      }

    // One run start to finish, against the run's clock. When time's up the run fails and its slot frees up, even if
    // something inside never answers. Whatever goes wrong ends up on the run as its error, so the card can show it.
    async execute({ run, task })
      {
        const log = this.logFor(run.id);
        const deadline = new Deadline(this.runMs, "This run");
        try
          {
            await log.start();
            await log.finish(await deadline.race(this.work({ task, run, log, signal: deadline.signal })));
          }
        catch(error)
          {
            await log.fail(error);
          }
      }

    // Starts the task's work for this run, gives an agent its tools, and turns the agent's answer into the result.
    async work({ task, run, log, signal })
      {
        const work = await task.start(run);
        const agent = this.buildAgent({ task, tools: work.tools(), log, signal, budget: new RunBudget(run.budget) });
        return work.result(await agent.run(work.brief()));
      }

    // Waits until nothing is queued or running. Tests use it, and so could a clean shutdown.
    async idle()
      {
        while(this.running.size || this.queue.length) await Promise.allSettled([...this.running]);
      }
  }
