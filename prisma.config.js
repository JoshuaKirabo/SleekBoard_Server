import "dotenv/config";
import { defineConfig } from "prisma/config";

// Where Prisma's command line finds the schema, the migrations and the database. Migrations run as the owner
// (MIGRATE_DATABASE_URL), since the server's own user can't create or change tables. The server connects in
// src/config/prisma.js.
export default defineConfig(
  {
    schema: "prisma/schema.prisma",
    migrations: { path: "prisma/migrations" },
    datasource: { url: process.env.MIGRATE_DATABASE_URL },
  });
