import { StatusCodes } from "http-status-codes";
import { runStore, runner } from "../agent/container.js";
import { Job } from "../models/job.model.js";

// GET /api/runs/:id. The card asks every second or so while a run is going, and reads the steps as they land.
export const getRun = async (req, res) =>
  {
    const run = await runStore.find(req.params.id);
    if(!run) return res.status(StatusCodes.NOT_FOUND).json({ message: "That run doesn't exist." });
    res.json(run);
  };

// POST /api/runs { kind, job }. Answers straight away with the queued run, and the card follows it with GET
// /api/runs/:id. An unknown kind is a 400 and a full day is a 429, both from the runner. A bad job id is a 404 through
// errorHandler.
export const createRun = async (req, res) =>
  {
    const jobId = String(req.body?.job || "").trim();
    if(!jobId) return res.status(StatusCodes.BAD_REQUEST).json({ message: "Send the job's id." });
    const job = await Job.exists({ _id: jobId });
    if(!job) return res.status(StatusCodes.NOT_FOUND).json({ message: "That job doesn't exist." });
    res.status(StatusCodes.ACCEPTED).json(await runner.submit(String(req.body?.kind || ""), job._id));
  };
