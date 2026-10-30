import { RUN_USD } from "./Runner.js";

// The three AI limits from .env, checked once when the server boots. Number("abc") and Number("1,50") are NaN, and
// every comparison with NaN is false, so a typo used to switch the daily cap off without a word. Now a bad value stops
// the server from starting, with a sentence naming the line to fix.
//
// 20 runs and a dollar a day, and 10 cents a run, unless .env says otherwise. A contact search costs about 1 to 2 cents.
export class AiLimits
  {
    constructor(env)
      {
        this.env = env;
        this.dailyRuns = this.runs("AI_DAILY_RUNS", 20);
        this.dailyUsd = this.dollars("AI_DAILY_USD", 1, { zeroOk: true });
        this.runUsd = this.dollars("AI_RUN_USD", RUN_USD, { zeroOk: false });
      }

    // A whole number of runs, 0 or more. 0 switches AI runs off.
    runs(name, fallback)
      {
        const value = this.read(name, fallback);
        if(!Number.isInteger(value) || value < 0) throw this.wrong(name, "a whole number of runs, 0 or more");
        return value;
      }

    // Dollars. A day's limit can be 0, which switches AI runs off. A run's budget can't, since every run would fail
    // the moment it started.
    dollars(name, fallback, { zeroOk })
      {
        const value = this.read(name, fallback);
        const highEnough = zeroOk ? value >= 0 : value > 0;
        if(!Number.isFinite(value) || !highEnough) throw this.wrong(name, zeroOk ? "dollars, 0 or more, like 1 or 0.5" : "dollars above 0, like 0.1");
        return value;
      }

    // What .env says, or the default when the line isn't there. A blank value is a mistake, not a 0, so it reads as NaN
    // and gets refused.
    read(name, fallback)
      {
        const raw = this.env[name];
        if(raw === undefined) return fallback;
        if(raw.trim() === "") return NaN;
        return Number(raw);
      }

    wrong(name, expected)
      {
        return new Error(`${name} in .env is "${this.env[name]}", but it has to be ${expected}. Fix it and start the server again.`);
      }
  }
