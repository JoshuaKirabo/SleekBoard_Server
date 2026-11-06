import { prisma } from "../../config/prisma.js";
import { currentUser } from "../users/index.js";
import { jobStore } from "../jobs/index.js";
import { ContactBook } from "./ContactBook.js";
import { ConnectionBook } from "./ConnectionBook.js";
import { ConnectionsCsv } from "./ConnectionsCsv.js";
import { JobCard } from "./JobCard.js";
import { WarmLeads } from "./WarmLeads.js";

// The real contact pieces, built once, the way agent/container.js builds the agent's. Tests build their own.

export const contactBook = new ContactBook({ db: prisma, userId: () => currentUser.id() });
export const connectionBook = new ConnectionBook({ db: prisma, userId: () => currentUser.id() });
export const connectionsCsv = new ConnectionsCsv();
export const jobCard = new JobCard({ jobs: jobStore });
export const warmLeads = new WarmLeads({ book: contactBook, connections: connectionBook, card: jobCard });
