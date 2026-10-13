import "dotenv/config";
import app from "./app.js";
import { connectDB } from "./config/db.js";

const PORT = process.env.PORT || 5000;

// Mongo first, then the server. No point taking requests we can't answer.
const start = async () =>
  {
    try
      {
        await connectDB(process.env.MONGO_URI);
        app.listen(PORT, () => console.log(`SleekBoard API listening on http://localhost:${PORT}`));
      }
    catch(error)
      {
        console.error("Couldn't start the server:", error.message);
        process.exit(1);
      }
  };

start();
