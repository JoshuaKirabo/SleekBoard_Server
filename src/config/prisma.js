import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.ts";
import { DatabaseUrl } from "./DatabaseUrl.js";

// The one Postgres client for the whole server. Each client keeps its own pool of connections, so making more than
// one would just eat into Postgres' limit. The client is written by `npm run db:generate` from prisma/schema.prisma.
//
// It connects as sleekboard_app, which can only read and write rows (see prisma/roles.sql), and refuses a database
// off this Mac unless the connection is encrypted.
const url = new DatabaseUrl(process.env.DATABASE_URL).requireSafe();
const adapter = new PrismaPg({ connectionString: url.toString() });

export const prisma = new PrismaClient({ adapter });
