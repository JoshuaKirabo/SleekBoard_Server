import { StatusCodes } from "http-status-codes";
import { prisma } from "../config/prisma.js";

// How long the database gets to answer before the check says it's down. A Postgres that's gone can leave a query
// waiting much longer than that.
const WAIT_MS = 3000;

// Asks Postgres for one row. True if it answered in time.
const databaseAnswers = async () =>
  {
    let timer;
    const late = new Promise((resolve) => timer = setTimeout(resolve, WAIT_MS, false));
    try
      {
        return await Promise.race([prisma.user.findFirst({ select: { id: true } }).then(() => true), late]);
      }
    catch
      {
        return false;
      }
    finally
      {
        clearTimeout(timer);
      }
  };

// Quick check that the API is up and still has a database behind it.
export const getHealth = async (req, res) =>
  {
    const ok = await databaseAnswers();
    res.status(ok ? StatusCodes.OK : StatusCodes.SERVICE_UNAVAILABLE).json({ status: ok ? "ok" : "degraded", database: ok ? "connected" : "unreachable", uptime: process.uptime(), timestamp: new Date().toISOString() });
  };
