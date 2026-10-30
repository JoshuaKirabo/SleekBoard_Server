import { StatusCodes } from "http-status-codes";
import { Job } from "../models/job.model.js";
import { contactBook, warmLeads } from "../services/contacts/index.js";

const jobFor = async (id) => Job.findById(id);

// GET /api/jobs/:id/contacts. Everything the panel's Contacts section shows: who's saved for this job, and the warm
// leads at its company (people saved for other jobs there, and LinkedIn connections).
export const listJobContacts = async (req, res) =>
  {
    const job = await jobFor(req.params.id);
    if(!job) return res.status(StatusCodes.NOT_FOUND).json({ message: "That job doesn't exist." });
    res.json(await warmLeads.forJob(job));
  };

// POST /api/jobs/:id/contacts { contact } or { connection }. Takes on a warm lead for this job: a contact you saved
// before, or one of your LinkedIn connections. Sends back the contact and the job.
export const useWarmLead = async (req, res) =>
  {
    const job = await jobFor(req.params.id);
    if(!job) return res.status(StatusCodes.NOT_FOUND).json({ message: "That job doesn't exist." });
    const { contact, connection } = req.body || {};
    if(typeof contact === "string") return res.json(await warmLeads.useContact(job, contact));
    if(typeof connection === "string") return res.json(await warmLeads.useConnection(job, connection));
    res.status(StatusCodes.BAD_REQUEST).json({ message: "Send a contact or a connection id." });
  };

// DELETE /api/jobs/:id/contacts/:contactId. Takes someone off this job. They stay in your contacts, so they can still
// turn up as a warm lead for another job.
export const removeJobContact = async (req, res) =>
  {
    const contact = await contactBook.unlink(req.params.contactId, req.params.id);
    if(!contact) return res.status(StatusCodes.NOT_FOUND).json({ message: "That contact doesn't exist." });
    res.status(StatusCodes.NO_CONTENT).end();
  };
