import express from "express";
import cors from "cors";
import routes from "./routes/index.js";
import { notFound } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/errorHandler.js";

const app = express();

// Only the client's origin gets through. Leave CLIENT_URL empty in dev to allow everything.
app.use(cors({ origin: process.env.CLIENT_URL || true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", routes);

// Anything that fell past the routes lands here, in this order.
app.use(notFound);
app.use(errorHandler);

export default app;
