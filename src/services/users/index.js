import { prisma } from "../../config/prisma.js";
import { Owner } from "./Owner.js";

// Until sign-in exists, everything belongs to the account named by OWNER_EMAIL. Sign-in will hand each request the
// person signed in instead.
export const owner = new Owner({ db: prisma, email: process.env.OWNER_EMAIL });
