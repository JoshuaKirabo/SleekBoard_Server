import { CompanyMatch } from "./CompanyMatch.js";
import { ContactFields } from "./ContactFields.js";

// The most connections one upload keeps. A big LinkedIn network is a few thousand; this is far past that.
const MAX_CONNECTIONS = 30_000;

// Best match first, then the most recent connection: recency is the closest thing the export has to how well you
// know someone (career-ops' joinConnections order).
const TIER_RANK = { exact: 0, strong: 1 };

// Rows per insert. Postgres takes at most 65,535 values in one statement, and a connection is about ten.
const BATCH = 2000;

// Every read and write of your LinkedIn connections, in Postgres, limited to one person's like ContactBook.
export class ConnectionBook
  {
    constructor({ db, userId, match = new CompanyMatch(), fields = new ContactFields() })
      {
        this.db = db;
        this.userId = userId;
        this.match = match;
        this.fields = fields;
      }

    // Swaps the whole list for a new upload, in one transaction, so a failed upload leaves the old list. Each
    // connection's company is split into words once, here.
    async replace(connections)
      {
        if(connections.length > MAX_CONNECTIONS) throw Object.assign(new Error(`That's ${connections.length.toLocaleString("en-US")} connections. The most it takes is ${MAX_CONNECTIONS.toLocaleString("en-US")}.`), { status: 413 });
        const userId = await this.userId();
        const rows = connections.map((connection) => this.rowOf(connection, userId)).filter(Boolean);
        await this.db.$transaction(async (tx) =>
          {
            await tx.connection.deleteMany({ where: { userId } });
            for(let at = 0; at < rows.length; at += BATCH)
              await tx.connection.createMany({ data: rows.slice(at, at + BATCH) });
          }, { timeout: 120000 });
        return this.summary();
      }

    // A connection as it's saved, or null for one that can't be kept.
    rowOf(connection, userId)
      {
        const clean = this.fields.forConnection(connection);
        if(!clean) return null;
        const tokens = this.match.tokensOf(clean.company);
        return { ...clean, userId, tokensAll: tokens.all, tokensDistinctive: tokens.distinctive, tokensKey: tokens.key || null };
      }

    async clear()
      {
        await this.db.connection.deleteMany({ where: { userId: await this.userId() } });
      }

    // How many are saved and when they were uploaded, so the card can say whether there's anything to look in.
    async summary()
      {
        const where = { userId: await this.userId() };
        const [count, newest] = await Promise.all([this.db.connection.count({ where }), this.db.connection.findFirst({ where, orderBy: { createdAt: "desc" }, select: { createdAt: true } })]);
        return { count, importedAt: newest?.createdAt || null };
      }

    async find(id)
      {
        if(!id) return null;
        const row = await this.db.connection.findFirst({ where: { id: String(id), userId: await this.userId() } });
        return row && this.shapeOf(row);
      }

    // LinkedIn's own search for 2nd-degree connections at the company, for you to open yourself.
    secondDegreeSearch(company)
      {
        return this.match.secondDegreeSearch(company);
      }

    // Connections at this company, exact and strong matches only. Weak ones ("Epic Systems" against "Epic Games") are
    // left out, the way career-ops leaves them out unless you ask. Each comes with how it matched and the company the
    // way LinkedIn wrote it, so you see both names and make the last call.
    async matchesFor(company)
      {
        const target = this.match.tokensOf(company);
        if(!target.key) return [];
        const sameCompany = [{ tokensKey: target.key }, ...(target.distinctive.length ? [{ tokensDistinctive: { hasSome: target.distinctive } }] : [])];
        const candidates = await this.db.connection.findMany({ where: { userId: await this.userId(), OR: sameCompany }, take: 500 });
        return candidates
          .map((row) => ({ row, tier: this.match.tier(this.tokensOf(row), target) }))
          .filter(({ tier }) => tier === "exact" || tier === "strong")
          .sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || b.row.connectedOn.localeCompare(a.row.connectedOn) || a.row.name.localeCompare(b.row.name))
          .slice(0, 20)
          .map(({ row, tier }) => ({ ...this.shapeOf(row), match: tier }));
      }

    tokensOf(row)
      {
        return { all: row.tokensAll, distinctive: row.tokensDistinctive, key: row.tokensKey || "" };
      }

    shapeOf(row)
      {
        const { userId, tokensAll, tokensDistinctive, tokensKey, ...connection } = row;
        return connection;
      }
  }
