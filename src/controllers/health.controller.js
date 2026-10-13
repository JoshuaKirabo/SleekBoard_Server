import mongoose from "mongoose";
import { StatusCodes } from "http-status-codes";

const DB_STATES = ["disconnected", "connected", "connecting", "disconnecting"];

// Quick check that the API is up and still has a database behind it.
export const getHealth = (req, res) =>
  {
    const database = DB_STATES[mongoose.connection.readyState] || "unknown";
    const ok = database === "connected";

    res.status(ok ? StatusCodes.OK : StatusCodes.SERVICE_UNAVAILABLE).json({ status: ok ? "ok" : "degraded", database, uptime: process.uptime(), timestamp: new Date().toISOString() });
  };
