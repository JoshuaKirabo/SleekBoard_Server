import { prisma } from "../../config/prisma.js";
import { Owner } from "../users/Owner.js";
import { JobFields } from "./JobFields.js";
import { JobStore } from "./JobStore.js";
import { LaneHistory } from "./LaneHistory.js";

// The real job pieces, built once. Tests build their own.
//
// Until sign-in exists every job belongs to the owner in .env. Sign-in will hand each request its own JobStore for
// the person signed in.
export const owner = new Owner({ db: prisma, email: process.env.OWNER_EMAIL });
export const jobStore = new JobStore({ db: prisma, userId: () => owner.id() });
export const jobFields = new JobFields();
export const laneHistory = new LaneHistory({ jobs: jobStore });
