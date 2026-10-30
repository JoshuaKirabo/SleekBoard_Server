import { Router } from "express";
import { createRun, getRun, listRuns, decideSuggestion } from "../controllers/runs.controller.js";

const router = Router();

router.get("/", listRuns);
router.post("/", createRun);
router.get("/:id", getRun);
router.post("/:id/suggestions/:index", decideSuggestion);

export default router;
