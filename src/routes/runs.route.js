import { Router } from "express";
import { getRun } from "../controllers/runs.controller.js";

const router = Router();

// Starting a run lands in piece 3, once there's a contact finder to start.
router.get("/:id", getRun);

export default router;
