import { parse } from "pg-connection-string";

// Where the database is, and whether it's safe to talk to it. A database on this Mac is fine as it is. Anywhere else
// the connection has to be encrypted, or passwords and rows would cross the network in the clear. Cloud SQL's
// connector on Cloud Run (a /cloudsql/ socket) encrypts on its own.
//
// The address is read with pg's own parser, so this sees exactly what the real connection will do: which host wins
// when the address gives two, and whether pg turns encryption on for its sslmode.
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1"];

export class DatabaseUrl
  {
    constructor(text)
      {
        if(!text) throw new Error("DATABASE_URL is missing from .env");
        this.text = text;
        this.config = parse(text);
      }

    host()
      {
        return this.config.host || "";
      }

    isLocal()
      {
        return LOCAL_HOSTS.includes(this.host());
      }

    isCloudSqlSocket()
      {
        return this.host().startsWith("/cloudsql/");
      }

    // pg encrypts whenever ssl is set at all. no-verify (or rejectUnauthorized off) encrypts but never checks the
    // server's certificate, so anyone in the middle could pose as the database; that doesn't count.
    isEncrypted()
      {
        return this.isCloudSqlSocket() || (Boolean(this.config.ssl) && this.checksCertificate());
      }

    checksCertificate()
      {
        const ssl = this.config.ssl;
        return ssl !== "no-verify" && ssl?.rejectUnauthorized !== false;
      }

    // Throws for a database that's neither on this Mac nor encrypted, before any connection is made. The message
    // names the host, never the password.
    requireSafe()
      {
        if(this.isLocal() || this.isEncrypted()) return this;
        throw new Error(`The database at ${this.host()} isn't on this Mac, so DATABASE_URL needs sslmode=require (or Cloud SQL's /cloudsql/ socket).`);
      }

    toString()
      {
        return this.text;
      }
  }
