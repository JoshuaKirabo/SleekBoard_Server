import { jobStore, laneHistory } from "../jobs/index.js";
import { LaneMove } from "./LaneMove.js";
import { ReplyDesk } from "./ReplyDesk.js";

// The real email pieces, built once, the way contacts/index.js builds the contact ones. Tests build their own.

export const laneMove = new LaneMove();
export const replyDesk = new ReplyDesk({ jobs: jobStore, history: laneHistory, lanes: laneMove });
