import { StatusCodes } from "http-status-codes";
import { runStore } from "../agent/container.js";

// GET /api/runs/:id. The card asks every second or so while a run is going, and reads the steps as they land.
export const getRun = async (req, res) =>
  {
    const run = await runStore.find(req.params.id);
    if(!run) return res.status(StatusCodes.NOT_FOUND).json({ message: "That run doesn't exist." });
    res.json(run);
  };
