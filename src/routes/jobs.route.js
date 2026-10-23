import { Router } from "express";
import { listJobs, createJob, updateJob, deleteJob, extractJob } from "../controllers/jobs.controller.js";

const router = Router();

router.get("/", listJobs);
router.post("/", createJob);
router.post("/extract", extractJob);
router.patch("/:id", updateJob);
router.delete("/:id", deleteJob);

export default router;
