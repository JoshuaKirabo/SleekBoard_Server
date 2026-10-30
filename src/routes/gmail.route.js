import { Router } from "express";
import { gmailStatus, connectGmail, gmailCallback, disconnectGmail } from "../controllers/gmail.controller.js";

const router = Router();

router.get("/status", gmailStatus);
router.get("/connect", connectGmail);
router.get("/callback", gmailCallback);
router.post("/disconnect", disconnectGmail);

export default router;
