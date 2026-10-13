import mongoose from "mongoose";

export const connectDB = async (uri) =>
  {
    if(!uri) throw new Error("MONGO_URI is missing from .env");

    const { connection } = await mongoose.connect(uri);
    console.log(`MongoDB connected: ${connection.host}/${connection.name}`);

    // Logging drops so a dead database doesn't fail silently in the background.
    connection.on("disconnected", () => console.warn("MongoDB disconnected"));
    connection.on("error", (error) => console.error("MongoDB error:", error.message));
  };
