import { Router } from "express";
import { getConnections, replaceConnections, clearConnections } from "../controllers/connections.controller.js";

const router = Router();

router.get("/", getConnections);
router.put("/", replaceConnections);
router.delete("/", clearConnections);

export default router;
