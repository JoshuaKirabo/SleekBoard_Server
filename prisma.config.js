import "dotenv/config";
import { defineConfig } from "prisma/config";

// Where Prisma's command line finds the schema, the migrations and the database. The server itself connects in
// src/config/prisma.js.
export default defineConfig(
  {
    schema: "prisma/schema.prisma",
    migrations: { path: "prisma/migrations" },
    datasource: { url: process.env.DATABASE_URL },
  });
