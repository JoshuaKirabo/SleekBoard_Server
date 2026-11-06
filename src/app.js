import express from "express";
import cors from "cors";
import routes from "./routes/index.js";
import { corsOrigins } from "./config/corsOrigins.js";
import { authSettings, sessionMiddleware, passport } from "./services/auth/index.js";
import { notFound } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/errorHandler.js";

const app = express();

// Only the board's own origins (CLIENT_URL) get through; with none set, no other site does. See corsOrigins.js.
app.use(cors({ origin: corsOrigins(process.env.CLIENT_URL), credentials: true }));
// Express turns away bodies over 100KB by default, but a job can carry an uploaded logo of up to 200,000 characters
// (see JobFields). 256KB fits that logo plus every other field at its cap.
// LinkedIn's Connections.csv runs about 150 bytes a person, so a big network is a few megabytes. Only that one route
// gets the bigger limit; the body is read once, so the line after this skips it.
app.use("/api/connections", express.json({ limit: "8mb" }));
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: true }));

// On Cloud Run, Google's proxy talks https to the browser and plain http to us. Trusting one hop lets the session see
// the real https, so its secure cookie gets set. It also makes req.ip the address Google's proxy saw (the last one it
// added to X-Forwarded-For, not one the browser made up), which the sign-in limits count by. Off Cloud Run nothing
// is trusted, so req.ip is whoever connected.
if(authSettings.isBehindProxy()) app.set("trust proxy", 1);
// Who's signed in: the session from the cookie, then passport turns its user id into req.user.
app.use("/api", sessionMiddleware, passport.authenticate("session"));

app.use("/api", routes);

// Anything that fell past the routes lands here, in this order.
app.use(notFound);
app.use(errorHandler);

export default app;
