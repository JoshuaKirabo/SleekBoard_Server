import { test } from "node:test";
import assert from "node:assert/strict";
import { KillSwitch } from "../src/KillSwitch.js";
import { KillSwitchSettings } from "../src/KillSwitchSettings.js";
import { BudgetNotice } from "../src/BudgetNotice.js";
import { Log } from "../src/Log.js";

const PROJECT = "sleekboard-prod";
const BUDGET = "de72f49d-779b-4945-a127-4d6ce8def0bb";
const ENV = { GOOGLE_CLOUD_PROJECT: PROJECT, BUDGET_ID: BUDGET };

// Stands in for CloudBillingClient: remembers every call, and billing goes off once it's been turned off, like the
// real project would.
class FakeBilling
  {
    constructor({ enabled = true, lookupFails = false } = {})
      {
        this.enabled = enabled;
        this.lookupFails = lookupFails;
        this.lookups = [];
        this.updates = [];
      }

    async getProjectBillingInfo(request)
      {
        this.lookups.push(request);
        if(this.lookupFails) throw new Error("PERMISSION_DENIED");
        return [{ name: request.name, billingEnabled: this.enabled }];
      }

    async updateProjectBillingInfo(request)
      {
        this.updates.push(request);
        this.enabled = false;
        return [{ name: request.name, billingEnabled: false }];
      }
  }

// Keeps the log lines so the tests can read them back.
const recordingLog = () =>
  {
    const lines = [];
    const log = new Log({ write: (line) => lines.push(JSON.parse(line)) });
    return { log, lines };
  };

const switchFor = ({ billing = new FakeBilling(), env = ENV } = {}) =>
  {
    const { log, lines } = recordingLog();
    const killSwitch = new KillSwitch({ billing, settings: new KillSwitchSettings({ env }), log });
    return { killSwitch, billing, lines };
  };

// The shape a CloudEvent function gets from a Pub/Sub trigger: the message at data.message, its data base64.
const eventWith = ({ data, attributes = { budgetId: BUDGET, schemaVersion: "1.0" } }) =>
  ({ data: { message: { data: Buffer.from(JSON.stringify(data)).toString("base64"), attributes } } });

const notice = (costAmount, budgetAmount = 10) =>
  eventWith({ data: { budgetDisplayName: "SleekBoard", costAmount, budgetAmount, currencyCode: "USD", costIntervalStart: "2026-11-01T07:00:00Z", budgetAmountType: "SPECIFIED_AMOUNT" } });

// --- what the switch does with a budget message ---

test("under budget: billing isn't looked up or touched", async () =>
  {
    const { killSwitch, billing, lines } = switchFor();
    assert.equal(await killSwitch.handle(notice(3.21)), "under-budget");
    assert.equal(billing.lookups.length, 0);
    assert.equal(billing.updates.length, 0);
    assert.equal(lines[0].severity, "INFO");
  });

test("exactly at the budget still counts as under, the same line Google's sample draws", async () =>
  {
    const { killSwitch, billing } = switchFor();
    assert.equal(await killSwitch.handle(notice(10, 10)), "under-budget");
    assert.equal(billing.updates.length, 0);
  });

test("over budget: billing is turned off once for the project in GOOGLE_CLOUD_PROJECT, even if the message comes twice", async () =>
  {
    const { killSwitch, billing, lines } = switchFor();
    assert.equal(await killSwitch.handle(notice(10.01)), "turned-off");
    assert.equal(await killSwitch.handle(notice(10.5)), "already-off");
    assert.deepEqual(billing.updates, [{ name: `projects/${PROJECT}`, projectBillingInfo: { billingAccountName: "" } }]);
    assert.deepEqual(billing.lookups, [{ name: `projects/${PROJECT}` }, { name: `projects/${PROJECT}` }]);
    assert.equal(lines[0].severity, "CRITICAL");
    assert.match(lines[0].message, /Turned billing off for projects\/sleekboard-prod/);
  });

test("already off: nothing is sent", async () =>
  {
    const { killSwitch, billing } = switchFor({ billing: new FakeBilling({ enabled: false }) });
    assert.equal(await killSwitch.handle(notice(50)), "already-off");
    assert.equal(billing.lookups.length, 1);
    assert.equal(billing.updates.length, 0);
  });

test("if the lookup fails it assumes billing is on and turns it off, like Google's sample", async () =>
  {
    const { killSwitch, billing, lines } = switchFor({ billing: new FakeBilling({ lookupFails: true }) });
    assert.equal(await killSwitch.handle(notice(50)), "turned-off");
    assert.equal(billing.updates.length, 1);
    assert.equal(lines[0].severity, "ERROR");
  });

test("a failed turn-off is thrown, so it shows as an error and the next message tries again", async () =>
  {
    const billing = new FakeBilling();
    billing.updateProjectBillingInfo = async () =>
      {
        throw new Error("PERMISSION_DENIED");
      };
    const { killSwitch } = switchFor({ billing });
    await assert.rejects(killSwitch.handle(notice(50)), /PERMISSION_DENIED/);
  });

test("SIMULATE_DEACTIVATION=true logs what it would do and sends nothing", async () =>
  {
    const { killSwitch, billing, lines } = switchFor({ env: { ...ENV, SIMULATE_DEACTIVATION: "true" } });
    assert.equal(await killSwitch.handle(notice(50)), "simulated");
    assert.equal(billing.updates.length, 0);
    assert.equal(lines[0].severity, "CRITICAL");
    assert.match(lines[0].message, /Would have turned billing off/);
  });

test("a message from another budget does nothing and is logged as an error", async () =>
  {
    const { killSwitch, billing, lines } = switchFor();
    const other = eventWith({ data: { costAmount: 500, budgetAmount: 10 }, attributes: { budgetId: "someone-elses-budget" } });
    const none = eventWith({ data: { costAmount: 500, budgetAmount: 10 }, attributes: {} });
    assert.equal(await killSwitch.handle(other), "other-budget");
    assert.equal(await killSwitch.handle(none), "other-budget");
    assert.equal(billing.lookups.length, 0);
    assert.equal(billing.updates.length, 0);
    assert.deepEqual(lines.map((line) => line.severity), ["ERROR", "ERROR"]);
  });

test("a message it can't read does nothing and is logged, never thrown", async () =>
  {
    const raw = (data) => ({ data: { message: { data, attributes: { budgetId: BUDGET } } } });
    const unreadable =
      [
        undefined,
        {},
        { data: {} },
        raw(undefined),
        raw(""),
        raw("not base64 json at all"),
        raw(Buffer.from("null").toString("base64")),
        raw(Buffer.from("[]").toString("base64")),
        eventWith({ data: {} }),
        eventWith({ data: { budgetAmount: 10 } }),
        eventWith({ data: { costAmount: 500 } }),
        eventWith({ data: { costAmount: "500", budgetAmount: "10" } }),
        eventWith({ data: { costAmount: null, budgetAmount: 10 } }),
        // The old background-function shape Google's Node sample reads, data straight on the event.
        { data: Buffer.from(JSON.stringify({ costAmount: 500, budgetAmount: 10 })).toString("base64") }
      ];
    for(const event of unreadable)
      {
        const { killSwitch, billing, lines } = switchFor();
        assert.equal(await killSwitch.handle(event), "unreadable", JSON.stringify(event));
        assert.equal(billing.lookups.length + billing.updates.length, 0);
        assert.equal(lines.length, 1);
        assert.equal(lines[0].severity, "ERROR");
        assert.match(lines[0].message, /Skipped a budget message I couldn't read/);
      }
  });

// --- BudgetNotice on its own ---

test("BudgetNotice reads the budget id and both amounts", () =>
  {
    const read = BudgetNotice.read(notice(12.5, 10));
    assert.equal(read.budgetId, BUDGET);
    assert.equal(read.costAmount, 12.5);
    assert.equal(read.budgetAmount, 10);
    assert.equal(read.isOverBudget(), true);
    assert.equal(read.describe(), "12.5 of 10");
  });

// --- KillSwitchSettings: the start stops on anything missing or mistyped ---

test("GOOGLE_CLOUD_PROJECT has to be set and look like a project id", () =>
  {
    const project = (value) => new KillSwitchSettings({ env: { GOOGLE_CLOUD_PROJECT: value } }).projectId();
    assert.equal(project(PROJECT), PROJECT);
    assert.equal(project(` ${PROJECT}\n`), PROJECT);
    assert.throws(() => project(undefined), /GOOGLE_CLOUD_PROJECT has to be set/);
    assert.throws(() => project("  "), /GOOGLE_CLOUD_PROJECT has to be set/);
    for(const bad of ["projects/sleekboard-prod", "SleekBoard", "sb", "sleekboard-", "1sleekboard", "sleek board"])
      {
        assert.throws(() => project(bad), /doesn't look like a project id/, bad);
      }
  });

test("BUDGET_ID has to be set, and only the id", () =>
  {
    const budget = (value) => new KillSwitchSettings({ env: { BUDGET_ID: value } }).budgetId();
    assert.equal(budget(BUDGET), BUDGET);
    assert.throws(() => budget(undefined), /BUDGET_ID has to be set/);
    assert.throws(() => budget(`billingAccounts/01D4EE-079462-DFD6EC/budgets/${BUDGET}`), /just the id/);
  });

test("SIMULATE_DEACTIVATION is off unless it says \"true\", and a typo stops the start", () =>
  {
    const simulated = (value) => new KillSwitchSettings({ env: { SIMULATE_DEACTIVATION: value } }).isSimulated();
    assert.equal(simulated(undefined), false);
    assert.equal(simulated(""), false);
    assert.equal(simulated("true"), true);
    for(const bad of ["True", "1", "yes", "false", "on"])
      {
        assert.throws(() => simulated(bad), /SIMULATE_DEACTIVATION only takes "true"/, bad);
      }
  });

test("the switch won't even build without a project or budget, so the deploy fails where it's seen", () =>
  {
    const { log } = recordingLog();
    assert.throws(() => new KillSwitch({ billing: new FakeBilling(), settings: new KillSwitchSettings({ env: { BUDGET_ID: BUDGET } }), log }), /GOOGLE_CLOUD_PROJECT/);
    assert.throws(() => new KillSwitch({ billing: new FakeBilling(), settings: new KillSwitchSettings({ env: { GOOGLE_CLOUD_PROJECT: PROJECT } }), log }), /BUDGET_ID/);
  });
