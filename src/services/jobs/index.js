import { prisma } from "../../config/prisma.js";
import { currentUser } from "../users/index.js";
import { JobFields } from "./JobFields.js";
import { JobStore } from "./JobStore.js";
import { LaneHistory } from "./LaneHistory.js";

// The real job pieces, built once. Tests build their own. Every job belongs to whoever's signed in (currentUser).
export const jobStore = new JobStore({ db: prisma, userId: () => currentUser.id() });
export const jobFields = new JobFields();
export const laneHistory = new LaneHistory({ jobs: jobStore });
