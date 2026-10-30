import { Router } from "express";
import { listJobs, createJob, updateJob, deleteJob, extractJob, decideReplySuggestion } from "../controllers/jobs.controller.js";
import { listJobContacts, useWarmLead, removeJobContact } from "../controllers/contacts.controller.js";

const router = Router();

router.get("/", listJobs);
router.post("/", createJob);
router.post("/extract", extractJob);
router.patch("/:id", updateJob);
router.delete("/:id", deleteJob);
router.post("/:id/reply-suggestion", decideReplySuggestion);
router.get("/:id/contacts", listJobContacts);
router.post("/:id/contacts", useWarmLead);
router.delete("/:id/contacts/:contactId", removeJobContact);

export default router;
