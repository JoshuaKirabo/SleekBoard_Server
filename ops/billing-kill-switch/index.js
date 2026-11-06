// The Cloud Run function Google's budget wakes through Pub/Sub. Entry point: stopBilling (the name Google's guide
// uses). Registered as a CloudEvent function, the way Google's 2nd gen Pub/Sub samples do it, so the framework hands
// over the event in one known shape. Setup and what this does and doesn't do: README.md next to this file.
import functions from "@google-cloud/functions-framework";
import { CloudBillingClient } from "@google-cloud/billing";
import { KillSwitch } from "./src/KillSwitch.js";
import { KillSwitchSettings } from "./src/KillSwitchSettings.js";
import { Log } from "./src/Log.js";

// Built when the function starts, so a missing setting fails the deploy rather than the day it's needed.
const killSwitch = new KillSwitch({ billing: new CloudBillingClient(), settings: new KillSwitchSettings(), log: new Log() });

functions.cloudEvent("stopBilling", (cloudEvent) => killSwitch.handle(cloudEvent));
