import { prisma } from "../../config/prisma.js";
import { owner } from "../users/index.js";
import { JobFields } from "./JobFields.js";
import { JobStore } from "./JobStore.js";
import { LaneHistory } from "./LaneHistory.js";

// The real job pieces, built once. Tests build their own. Every job belongs to the owner until sign-in exists.
export const jobStore = new JobStore({ db: prisma, userId: () => owner.id() });
export const jobFields = new JobFields();
export const laneHistory = new LaneHistory({ jobs: jobStore });
