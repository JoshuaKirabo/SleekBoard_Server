import express from "express";
import cors from "cors";
import routes from "./routes/index.js";
import { notFound } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/errorHandler.js";

const app = express();

// Only the client's origins get through. CLIENT_URL takes one or a comma-separated list; leave it empty in dev to
// allow everything. localhost and 127.0.0.1 are the same Mac, so either one also lets the other in on the same port.
const LOOPBACK = ["localhost", "127.0.0.1"];
const allowedOrigins = (process.env.CLIENT_URL || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean)
  .flatMap((origin) =>
    {
      const url = new URL(origin);
      if(!LOOPBACK.includes(url.hostname)) return [url.origin];
      return LOOPBACK.map((host) =>
        {
          url.hostname = host;
          return url.origin;
        });
    });
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : true, credentials: true }));
// Express turns away bodies over 100KB by default, but a job can carry an uploaded logo of up to 200,000 characters
// (see job.model.js). 256KB fits that logo plus every other field at its cap.
// LinkedIn's Connections.csv runs about 150 bytes a person, so a big network is a few megabytes. Only that one route
// gets the bigger limit; the body is read once, so the line after this skips it.
app.use("/api/connections", express.json({ limit: "8mb" }));
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", routes);

// Anything that fell past the routes lands here, in this order.
app.use(notFound);
app.use(errorHandler);

export default app;
