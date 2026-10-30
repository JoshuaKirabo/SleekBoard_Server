import { test } from "node:test";
import assert from "node:assert/strict";
import { AiLimits } from "../../src/agent/AiLimits.js";
import { SpendingCap, CapReachedError } from "../../src/agent/SpendingCap.js";
import { RUN_USD } from "../../src/agent/Runner.js";
import { MemoryRunStore } from "../fakes.js";

const NAMES = ["AI_DAILY_RUNS", "AI_DAILY_USD", "AI_RUN_USD"];

// A day that has already spent $99 over 5 finished runs.
const spentStore = () => new MemoryRunStore(Array.from({ length: 5 }, (_, i) => ({ id: `old-${i}`, status: "done", cost: 99 / 5, budget: 0.1, createdAt: new Date() })));

test("with no AI lines in .env, the defaults are used", () =>
  {
    const limits = new AiLimits({});
    assert.equal(limits.dailyRuns, 20);
    assert.equal(limits.dailyUsd, 1);
    assert.equal(limits.runUsd, RUN_USD);
  });

test("good values are read as numbers", () =>
  {
    const limits = new AiLimits({ AI_DAILY_RUNS: "8", AI_DAILY_USD: " 2.5 ", AI_RUN_USD: "0.05" });
    assert.equal(limits.dailyRuns, 8);
    assert.equal(limits.dailyUsd, 2.5);
    assert.equal(limits.runUsd, 0.05);
  });

test("a typo in any AI line stops the server from starting", () =>
  {
    for(const name of NAMES)
      {
        for(const typo of ["abc", "1,50", "$1", "", "   ", "Infinity", "NaN"])
          {
            assert.throws(() => new AiLimits({ [name]: typo }), (error) => error.message.startsWith(`${name} in .env is "${typo}"`), `${name}="${typo}"`);
          }
      }
  });

test("a negative limit is refused", () =>
  {
    for(const name of NAMES) assert.throws(() => new AiLimits({ [name]: "-1" }), new RegExp(name));
  });

test("runs a day has to be a whole number", () =>
  {
    assert.throws(() => new AiLimits({ AI_DAILY_RUNS: "2.5" }), /AI_DAILY_RUNS/);
  });

test("0 switches the daily limits off, but a run's budget can't be 0", () =>
  {
    const limits = new AiLimits({ AI_DAILY_RUNS: "0", AI_DAILY_USD: "0" });
    assert.equal(limits.dailyRuns, 0);
    assert.equal(limits.dailyUsd, 0);
    assert.throws(() => new AiLimits({ AI_RUN_USD: "0" }), /AI_RUN_USD/);
  });

test("a cap built with NaN limits still refuses, so a bad number fails closed", async () =>
  {
    const store = spentStore();
    await assert.rejects(new SpendingCap({ store, maxRuns: NaN, maxUsd: 1000 }).check(0.1), CapReachedError);
    await assert.rejects(new SpendingCap({ store, maxRuns: 20, maxUsd: NaN }).check(0.1), CapReachedError);
    await assert.rejects(new SpendingCap({ store: new MemoryRunStore(), maxRuns: 20, maxUsd: 1 }).check(NaN), CapReachedError);
  });
