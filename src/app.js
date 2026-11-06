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

// How many proxies in front of us Express believes about the visitor's address (TRUST_PROXY_HOPS; AuthSettings).
// Each proxy adds the address it saw to the right of X-Forwarded-For, so Express skips that many from the right and
// req.ip is the next one. The sign-in limits count by req.ip, and trusting the first hop also lets the session see
// Google's https, so its secure cookie gets set.
//   0  nothing in front (this Mac): req.ip is whoever connected.
//   1  plain Cloud Run (the default there): the address Google's front end saw connect.
//   2  Cloudflare, or a Google load balancer, in front of Cloud Run: the address Cloudflare (or the balancer) saw.
// It has to match what is really in front. One too many and req.ip is an entry the visitor typed into the header
// themselves, so they could dodge the sign-in limits or lock someone else out. With 2, anyone reaching Cloud Run
// directly (not through Cloudflare) is one hop short and could do the same, which is why the origin lock exists.
app.set("trust proxy", authSettings.trustProxyHops());
// Who's signed in: the session from the cookie, then passport turns its user id into req.user.
app.use("/api", sessionMiddleware, passport.authenticate("session"));

app.use("/api", routes);

// Anything that fell past the routes lands here, in this order.
app.use(notFound);
app.use(errorHandler);

export default app;
