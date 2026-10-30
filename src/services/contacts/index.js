import { Contact } from "../../models/contact.model.js";
import { Connection } from "../../models/connection.model.js";
import { Job } from "../../models/job.model.js";
import { ContactBook } from "./ContactBook.js";
import { ConnectionBook } from "./ConnectionBook.js";
import { ConnectionsCsv } from "./ConnectionsCsv.js";
import { JobCard } from "./JobCard.js";
import { WarmLeads } from "./WarmLeads.js";

// The real contact pieces, built once, the way agent/container.js builds the agent's. Tests build their own.

export const contactBook = new ContactBook({ Contact });
export const connectionBook = new ConnectionBook({ Connection });
export const connectionsCsv = new ConnectionsCsv();
export const jobCard = new JobCard({ Job });
export const warmLeads = new WarmLeads({ book: contactBook, connections: connectionBook, card: jobCard });
