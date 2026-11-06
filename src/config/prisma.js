import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.ts";

// The one Postgres client for the whole server. Each client keeps its own pool of connections, so making more than
// one would just eat into Postgres' limit. The client is written by `npm run db:generate` from prisma/schema.prisma.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

export const prisma = new PrismaClient({ adapter });
