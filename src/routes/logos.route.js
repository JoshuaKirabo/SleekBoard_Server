import { Router } from "express";
import { getLogo } from "../controllers/logos.controller.js";

const router = Router();

router.get("/:domain", getLogo);

export default router;
