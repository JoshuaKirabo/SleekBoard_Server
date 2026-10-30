import { StatusCodes } from "http-status-codes";
import { Job, JOB_FIELDS, STATUSES } from "../models/job.model.js";
import { readJob } from "../services/jobReader.js";
import { contactBook } from "../services/contacts/index.js";
import { laneHistory } from "../services/jobs/index.js";
import { replyDesk } from "../services/email/index.js";

// Express 5 passes a rejected handler straight to the error middleware, so these don't need their own try/catch.
// Bad ids come back as 404 and failed validation as 400, see errorHandler.

// Copies only the editable fields off the body.
const pick = (body = {}) => Object.fromEntries(JOB_FIELDS.filter((key) => key in body).map((key) => [key, body[key]]));

// GET /api/jobs. Most recently touched first.
export const listJobs = async (req, res) =>
  {
    res.json(await Job.find().sort({ updatedAt: -1 }));
  };

// POST /api/jobs
export const createJob = async (req, res) =>
  {
    res.status(StatusCodes.CREATED).json(await Job.create(pick(req.body)));
  };

// PATCH /api/jobs/:id. Send just what changed, like { status: "interviewing" } after a drag. A lane change goes in the
// card's history. { status, undo: true } is the toast's Undo: it takes the last move back off instead of adding one.
export const updateJob = async (req, res) =>
  {
    const job = await Job.findById(req.params.id);
    if(!job) return res.status(StatusCodes.NOT_FOUND).json({ message: "That job doesn't exist." });
    const { status, ...rest } = pick(req.body);
    if(status !== undefined && !STATUSES.includes(status)) return res.status(StatusCodes.BAD_REQUEST).json({ message: `${status} isn't a lane.` });
    const moved = status === undefined ? job : await moveLane(job, status, req.body?.undo === true);
    if(!moved) return res.status(StatusCodes.CONFLICT).json({ message: "That card just moved. Refresh and try again." });
    if(!Object.keys(rest).length) return res.json(moved);
    res.json(await Job.findByIdAndUpdate(job._id, rest, { new: true, runValidators: true }));
  };

// A lane change from the board, or its undo.
const moveLane = (job, status, undo) => undo ? laneHistory.undo(job, status) : laneHistory.move(job, status, "board");

// DELETE /api/jobs/:id. The job comes off any contacts saved for it; the people stay, for warm leads later.
export const deleteJob = async (req, res) =>
  {
    const job = await Job.findByIdAndDelete(req.params.id);
    if(!job) return res.status(StatusCodes.NOT_FOUND).json({ message: "That job doesn't exist." });
    await contactBook.dropJob(job._id);
    res.status(StatusCodes.NO_CONTENT).end();
  };

// POST /api/jobs/extract { url }. Opens the listing and sends back what it could read. A ReadError carries its own
// status, so a site that blocks us comes back as a plain message the add sheet can show.
export const extractJob = async (req, res) =>
  {
    const url = String(req.body?.url || "").trim();
    if(!url) return res.status(StatusCodes.BAD_REQUEST).json({ message: "Send a url to read." });
    res.json(await readJob(url));
  };

// POST /api/jobs/:id/reply-suggestion { decision: "accept" | "dismiss" }. Your answer to a move a reply suggested.
// Accept moves the card and sends it back. A card with no suggestion, or one that has moved on since, is a 409.
export const decideReplySuggestion = async (req, res) =>
  {
    res.json(await replyDesk.decide(req.params.id, String(req.body?.decision || "")));
  };
