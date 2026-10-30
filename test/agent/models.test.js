import { test } from "node:test";
import assert from "node:assert/strict";
import { Model } from "../../src/agent/Model.js";
import { ModelLadder } from "../../src/agent/ModelLadder.js";
import { MODELS } from "../../src/agent/models.js";

const ladder = new ModelLadder(MODELS.map((settings) => new Model(settings)));

test("a model prices a reply per million tokens", () =>
  {
    const model = new Model({ rung: 1, id: "x", priceIn: 0.3, priceOut: 1.2 });
    assert.equal(model.costOf({ input: 1_000_000, output: 500_000 }), 0.9);
  });

test("the ladder picks the cheapest model that can do the job", () =>
  {
    assert.equal(ladder.pick(1, "tools").rung, 1);
    assert.equal(ladder.pick(2, "tools").rung, 2);
  });

test("a model that can't call tools is skipped for agent work", () =>
  {
    assert.equal(ladder.pick(4, "json").name, "Kimi K3");
    assert.throws(() => ladder.pick(4, "tools"), /No model on rung 4/);
  });

test("climbing goes one capable rung up and stops at the top", () =>
  {
    assert.equal(ladder.above(ladder.pick(1, "tools"), "tools").rung, 2);
    assert.equal(ladder.above(ladder.pick(3, "tools"), "tools"), null);
  });

test("the ladder sorts itself even when the config isn't in order", () =>
  {
    const shuffled = new ModelLadder([new Model({ rung: 3, id: "c", abilities: ["tools"] }), new Model({ rung: 1, id: "a", abilities: ["tools"] })]);
    assert.equal(shuffled.pick(1, "tools").id, "a");
  });
