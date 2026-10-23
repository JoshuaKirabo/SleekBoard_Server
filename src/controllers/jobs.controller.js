import { StatusCodes } from "http-status-codes";
import { Job, JOB_FIELDS } from "../models/job.model.js";
import { readJob } from "../services/jobReader.js";

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

// PATCH /api/jobs/:id. Send just what changed, like { status: "interviewing" } after a drag.
export const updateJob = async (req, res) =>
  {
    const job = await Job.findByIdAndUpdate(req.params.id, pick(req.body), { new: true, runValidators: true });
    if(!job) return res.status(StatusCodes.NOT_FOUND).json({ message: "That job doesn't exist." });
    res.json(job);
  };

// DELETE /api/jobs/:id
export const deleteJob = async (req, res) =>
  {
    const job = await Job.findByIdAndDelete(req.params.id);
    if(!job) return res.status(StatusCodes.NOT_FOUND).json({ message: "That job doesn't exist." });
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
