import { StatusCodes } from "http-status-codes";
import { connectionBook, connectionsCsv } from "../services/contacts/index.js";

// GET /api/connections. How many LinkedIn connections are saved, and when they were uploaded.
export const getConnections = async (req, res) =>
  {
    res.json(await connectionBook.summary());
  };

// PUT /api/connections { csv }. The text of LinkedIn's Connections.csv. Replaces the whole list, and sends back the
// new count plus how many rows couldn't be used and why.
export const replaceConnections = async (req, res) =>
  {
    const csv = typeof req.body?.csv === "string" ? req.body.csv : "";
    if(!csv.trim()) return res.status(StatusCodes.BAD_REQUEST).json({ message: "Send the text of Connections.csv." });
    const { connections, quality } = connectionsCsv.parse(csv);
    if(quality.noHeader) return res.status(StatusCodes.BAD_REQUEST).json({ message: "That doesn't look like LinkedIn's Connections.csv. It needs First Name and Company columns." });
    res.json({ ...(await connectionBook.replace(connections)), quality });
  };

// DELETE /api/connections. Forgets every uploaded connection. Contacts you already took on from them stay.
export const clearConnections = async (req, res) =>
  {
    await connectionBook.clear();
    res.status(StatusCodes.NO_CONTENT).end();
  };
