// Cloud Run functions read a JSON line on stdout as a structured log entry, so the severity shows up in Cloud Logging
// and a log-based alert can watch for CRITICAL (billing turned off, for real or pretend).
export class Log
  {
    constructor({ write = console.log } = {})
      {
        this.write = write;
      }

    info(message)
      {
        this.entry("INFO", message);
      }

    error(message)
      {
        this.entry("ERROR", message);
      }

    critical(message)
      {
        this.entry("CRITICAL", message);
      }

    entry(severity, message)
      {
        this.write(JSON.stringify({ severity, message }));
      }
  }
