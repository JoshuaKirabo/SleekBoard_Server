import { Router } from "express";
import { attachRun, createRun, getRun, listRuns, decideSuggestion } from "../controllers/runs.controller.js";

const router = Router();

router.get("/", listRuns);
router.post("/", createRun);
router.get("/:id", getRun);
router.post("/:id/suggestions/:index", decideSuggestion);
router.post("/:id/job", attachRun);

export default router;
