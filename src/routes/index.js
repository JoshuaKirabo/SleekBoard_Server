import { Router } from "express";
import healthRoutes from "./health.route.js";
import logosRoutes from "./logos.route.js";
import jobsRoutes from "./jobs.route.js";

const router = Router();

// Each resource gets its own file and gets mounted here.
router.use("/health", healthRoutes);
router.use("/logos", logosRoutes);
router.use("/jobs", jobsRoutes);

export default router;
