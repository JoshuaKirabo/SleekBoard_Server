import { CompanyMatch } from "./CompanyMatch.js";

// The most connections one upload keeps. A big LinkedIn network is a few thousand; this is far past that.
const MAX_CONNECTIONS = 30_000;

// Best match first, then the most recent connection: recency is the closest thing the export has to how well you
// know someone (career-ops' joinConnections order).
const TIER_RANK = { exact: 0, strong: 1 };

// Every read and write of your LinkedIn connections. It gets the Mongoose model handed in.
export class ConnectionBook
  {
    constructor({ Connection, match = new CompanyMatch() })
      {
        this.Connection = Connection;
        this.match = match;
      }

    // Swaps the whole list for a new upload. Each connection's company is split into words once, here.
    async replace(connections)
      {
        if(connections.length > MAX_CONNECTIONS) throw Object.assign(new Error(`That's ${connections.length.toLocaleString("en-US")} connections. The most it takes is ${MAX_CONNECTIONS.toLocaleString("en-US")}.`), { status: 413 });
        const rows = connections.map((connection) => ({ ...connection, tokens: this.match.tokensOf(connection.company) }));
        await this.Connection.deleteMany({});
        if(rows.length) await this.Connection.insertMany(rows, { ordered: false });
        return this.summary();
      }

    clear()
      {
        return this.Connection.deleteMany({});
      }

    // How many are saved and when they were uploaded, so the card can say whether there's anything to look in.
    async summary()
      {
        const [count, newest] = await Promise.all([this.Connection.countDocuments(), this.Connection.findOne().sort({ createdAt: -1 }).select("createdAt")]);
        return { count, importedAt: newest?.createdAt || null };
      }

    find(id)
      {
        return this.Connection.findById(id);
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
        const candidates = await this.Connection.find({ $or: [{ "tokens.key": target.key }, { "tokens.distinctive": { $in: target.distinctive } }] }).limit(500);
        return candidates
          .map((connection) => ({ connection, tier: this.match.tier(connection.tokens, target) }))
          .filter(({ tier }) => tier === "exact" || tier === "strong")
          .sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || b.connection.connectedOn.localeCompare(a.connection.connectedOn) || a.connection.name.localeCompare(b.connection.name))
          .slice(0, 20)
          .map(({ connection, tier }) => ({ ...connection.toJSON(), match: tier }));
      }
  }
