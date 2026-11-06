import { Router } from "express";
import healthRoutes from "./health.route.js";
import logosRoutes from "./logos.route.js";
import jobsRoutes from "./jobs.route.js";
import runsRoutes from "./runs.route.js";
import connectionsRoutes from "./connections.route.js";
import gmailRoutes from "./gmail.route.js";
import authRoutes from "./auth.route.js";
import { requireUser } from "../middleware/requireUser.js";
import { currentUser } from "../services/users/index.js";

const router = Router();

// Each resource gets its own file and gets mounted here. Health and sign-in are open; everything after the lock needs
// a signed-in person and only sees their rows.
router.use("/health", healthRoutes);
router.use("/auth", authRoutes);
router.use(requireUser(currentUser));
router.use("/logos", logosRoutes);
router.use("/jobs", jobsRoutes);
router.use("/runs", runsRoutes);
router.use("/connections", connectionsRoutes);
router.use("/gmail", gmailRoutes);

export default router;
