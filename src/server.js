import "dotenv/config";
import app from "./app.js";
import { connectDB } from "./config/db.js";

const PORT = process.env.PORT || 5050;
// Only this Mac can reach it. Leaving the host off listens on every network, so anyone on the same Wi-Fi could hit
// /api/jobs. A deploy sets HOST=0.0.0.0 since the host's router has to get in.
const HOST = process.env.HOST || "127.0.0.1";

// Turns a failed listen into one plain sentence. Port problems name the port, host problems name the host.
const listenFailure = (error) =>
  {
    switch(error.code)
      {
        case "EADDRINUSE":
          return `port ${PORT} is already in use`;
        case "EACCES":
          return `port ${PORT} needs admin rights`;
        case "ENOTFOUND":
        case "EAI_AGAIN":
          return `HOST "${HOST}" isn't a name this Mac can look up`;
        case "EADDRNOTAVAIL":
          return `HOST "${HOST}" isn't an address on this Mac`;
        default:
          return error.message;
      }
  };

// Mongo first, then the server. No point taking requests we can't answer.
const start = async () =>
  {
    try
      {
        await connectDB(process.env.MONGODB_URI || process.env.MONGO_URI);
        // Express 5 hands a failed listen (port taken, bad host) to this callback instead of throwing, so check for it.
        app.listen(PORT, HOST, (error) =>
          {
            if(error)
              {
                console.error(`Couldn't start the server: ${listenFailure(error)}`);
                process.exit(1);
              }
            console.log(`SleekBoard Server listening on http://${HOST}:${PORT}`);
          });
      }
    catch(error)
      {
        console.error("Couldn't start the server:", error.message);
        process.exit(1);
      }
  };

start();
