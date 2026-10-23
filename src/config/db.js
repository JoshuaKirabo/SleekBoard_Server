import mongoose from "mongoose";

// Queries on fields the schema doesn't have are dropped instead of matching everything.
mongoose.set("strictQuery", true);

export const connectDB = async (uri) =>
  {
    if(!uri) throw new Error("MONGODB_URI is missing from .env");

    // Give up after 10 seconds instead of the default 30, so a wrong URI or a blocked Atlas IP shows up quickly.
    // The database is named here because an Atlas URI usually leaves it off, and Mongo would quietly use "test".
    const { connection } = await mongoose.connect(uri, { dbName: "sleekboard", serverSelectionTimeoutMS: 10000 });
    console.log(`MongoDB connected: ${connection.host}/${connection.name}`);

    // Logging drops so a dead database doesn't fail silently in the background.
    connection.on("disconnected", () => console.warn("MongoDB disconnected"));
    connection.on("error", (error) => console.error("MongoDB error:", error.message));
  };
