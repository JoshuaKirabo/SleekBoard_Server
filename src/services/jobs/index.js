import { Job } from "../../models/job.model.js";
import { LaneHistory } from "./LaneHistory.js";

// The real job pieces, built once. Tests build their own.

export const laneHistory = new LaneHistory({ Job });
