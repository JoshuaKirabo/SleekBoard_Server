import "dotenv/config";
import app from "./app.js";
import { DatabaseUrl } from "./config/DatabaseUrl.js";
import { runStore, mailTimer } from "./agent/container.js";
import { authSettings } from "./services/auth/index.js";

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

// Turns a failed first query into one plain sentence that names the database (never its password) and what to check.
const databaseFailure = (error) =>
  {
    const where = new DatabaseUrl(process.env.DATABASE_URL).label();
    switch(error.code)
      {
        case "ECONNREFUSED":
        case "ENOTFOUND":
        case "ETIMEDOUT":
        case "P1001":
          return `Postgres isn't answering at ${where}. Is it running, and is DATABASE_URL right?`;
        case "P1000":
        case "P1010":
          return `Postgres turned down the login for ${where}. Check the user in DATABASE_URL, and that prisma/roles.sql has been run.`;
        case "P1003":
          return `There's no database ${where}. Run npm run db:migrate first.`;
        default:
          return String(error.message || error).replace(/\s+/g, " ").trim();
      }
  };

// The database first, then the server. No point taking requests we can't answer. Marking interrupted runs is the
// first query, so a Postgres that's down or a wrong DATABASE_URL stops the start here with one sentence.
const start = async () =>
  {
    try
      {
        // Sign-in's settings first: no session secret, or a deploy that would let any site in, stops the start.
        authSettings.check();
        // Runs that were mid-way when the server last stopped can't finish now, so they get marked failed.
        await runStore.failInterrupted();
        // Checks your inbox for replies every so often. Does nothing until Gmail is connected.
        mailTimer.start();
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
        console.error(`Couldn't start the server: ${databaseFailure(error)}`);
        process.exit(1);
      }
  };

start();
