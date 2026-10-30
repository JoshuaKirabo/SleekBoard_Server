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
    async submit(kind, jobId)
      {
        const task = this.taskFor(kind);
        const run = await this.lock.hold(() => new Deadline(this.admitMs, "Starting a run").race(this.admit(kind, jobId, this.budgetFor(task))));
        this.enqueue({ run, task });
        return run;
      }

    // Checks the cap and saves the run with its budget. The budget goes on the run so the cap can hold it for the run
    // until it ends. It always runs under the lock, because two presses that check together both see room before
    // either has saved, and both get in. The deadline stops a stuck database call from jamming the lock for every run
    // after it.
    async admit(kind, jobId, budget)
      {
        await this.cap.check(budget);
        return this.store.create({ kind, job: jobId, budget });
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
            const agent = this.buildAgent({ task, log, signal: deadline.signal, budget: new RunBudget(run.budget) });
            await log.finish(await deadline.race(Promise.resolve().then(() => task.brief(run)).then((brief) => agent.run(brief))));
          }
        catch(error)
          {
            await log.fail(error);
          }
      }

    // Waits until nothing is queued or running. Tests use it, and so could a clean shutdown.
    async idle()
      {
        while(this.running.size || this.queue.length) await Promise.allSettled([...this.running]);
      }
  }
