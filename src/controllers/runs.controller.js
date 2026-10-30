import { StatusCodes } from "http-status-codes";
import { runStore, runner, suggestionDesk } from "../agent/container.js";
import { Job } from "../models/job.model.js";

// GET /api/runs/:id. The card asks every second or so while a run is going, and reads the steps as they land.
export const getRun = async (req, res) =>
  {
    const run = await runStore.find(req.params.id);
    if(!run) return res.status(StatusCodes.NOT_FOUND).json({ message: "That run doesn't exist." });
    res.json(run);
  };

// GET /api/runs?job=<id>. A job's runs, newest first, so reopening the panel picks up where the last run left off.
export const listRuns = async (req, res) =>
  {
    const jobId = String(req.query.job || "").trim();
    if(!jobId) return res.status(StatusCodes.BAD_REQUEST).json({ message: "Say which job's runs you want." });
    res.json(await runStore.forJob(jobId));
  };

// POST /api/runs { kind, job, contact? }. Answers straight away with the queued run, and the card follows it with GET
// /api/runs/:id. A note run also names its contact. An unknown kind is a 400 and a full day is a 429, both from the
// runner. A bad job id is a 404 through errorHandler.
export const createRun = async (req, res) =>
  {
    const jobId = String(req.body?.job || "").trim();
    if(!jobId) return res.status(StatusCodes.BAD_REQUEST).json({ message: "Send the job's id." });
    const job = await Job.exists({ _id: jobId });
    if(!job) return res.status(StatusCodes.NOT_FOUND).json({ message: "That job doesn't exist." });
    const input = typeof req.body?.contact === "string" ? { contact: req.body.contact } : {};
    res.status(StatusCodes.ACCEPTED).json(await runner.submit(String(req.body?.kind || ""), job._id, input));
  };

// POST /api/runs/:id/suggestions/:index { decision: "accept" | "reject" }. Accepting saves the person to your contacts
// for the run's job. Sends back the run, the saved contact (or null) and the job, whose Contact field may have filled
// in.
export const decideSuggestion = async (req, res) =>
  {
    const index = Number(req.params.index);
    res.json(await suggestionDesk.decide(req.params.id, index, String(req.body?.decision || "")));
  };
