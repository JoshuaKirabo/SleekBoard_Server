import { Router } from "express";
import healthRoutes from "./health.route.js";

const router = Router();

// Each resource gets its own file and gets mounted here.
router.use("/health", healthRoutes);

export default router;
