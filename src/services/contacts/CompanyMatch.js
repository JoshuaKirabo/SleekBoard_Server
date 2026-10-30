import { TextKey } from "./TextKey.js";

// Matching company names that people typed differently, ported from career-ops' linkedin-join.mjs (companyTokens,
// foldToken, matchCompany and secondDegreeSearchUrl). LinkedIn's company names are free text, so exact matching
// misses most real hits ("Siemens" against "Siemens Digital Industries Software"). Names get split into words, and
// the generic ones (Inc, Group, Technologies) are set aside. Then:
//
//   exact   the whole folded name is equal           "GE HealthCare" ~ "GE Healthcare"
//   strong  the distinctive words are the same set,   "Siemens" ~ "Siemens Digital Industries Software"
//           only filler differs
//   weak    some distinctive words overlap,           "Epic Systems" ~ "Epic Games"
//           but the sets aren't equal
//
// Never part of a word, so "Loop" isn't "Loopio". Exact and strong count as warm leads; weak is too likely to be a
// different employer.
//
// career-ops is MIT licensed: Copyright (c) 2026 Santiago Fernández de Valderrama.
// https://github.com/career-ops-hq/career-ops/blob/main/linkedin-join.mjs

// Words that don't tell one company from another. career-ops' list, word for word.
const GENERIC = new Set(
  [
    "the", "a", "an", "and", "of", "for",
    "inc", "incorporated", "llc", "llp", "ltd", "limited", "corp", "corporation",
    "co", "company", "gmbh", "mbh", "ag", "kg", "sa", "sas", "sarl", "bv", "nv",
    "ab", "oy", "as", "aps", "plc", "pty", "srl", "spa", "kk", "pte", "pvt",
    "holdings", "holding", "group", "groupe", "international", "global",
    "worldwide", "enterprises", "enterprise", "ventures", "capital", "partners",
    "associates", "consulting", "consultancy", "industries", "industrial",
    "technologies", "technology", "tech", "software", "systems", "system",
    "solutions", "solution", "services", "service", "labs", "lab", "digital",
    "data", "cloud", "ai", "health", "healthcare", "medical", "media", "network",
    "networks", "platform", "platforms", "security", "cybersecurity", "cyber",
    "financial", "finance", "insurance", "energy", "studio", "studios",
    "stealth", "startup", "unknown", "confidential", "undisclosed", "anon",
    "anonymous", "client", "various",
  ]);

export const TIERS = ["exact", "strong", "weak"];

export class CompanyMatch
  {
    constructor({ keys = new TextKey() } = {})
      {
        this.keys = keys;
      }

    // A name split into folded words. Anything in brackets is left out ("FORT (client undisclosed)" is FORT). The key
    // joins the words with no gap, because "GoDaddy" and "Go Daddy" are the same employer typed two ways.
    tokensOf(name)
      {
        const base = String(name || "").replace(/\([^)]*\)/g, " ");
        const all = base.split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean).map((token) => this.fold(token)).filter(Boolean);
        return { all, distinctive: all.filter((token) => !GENERIC.has(token)), key: all.join("") };
      }

    // One word folded to plain letters, so Ørsted is Orsted. A word with no Latin letters keeps its own script
    // instead of folding to nothing, so 株式会社X still matches 株式会社X.
    fold(token)
      {
        return this.keys.ascii(token, { punctuation: "delete" }) || this.keys.key(token);
      }

    // How well two tokenised names match: "exact", "strong", "weak", or null when they're unrelated.
    tier(a, b)
      {
        if(!a.key || !b.key) return null;
        if(a.key === b.key) return "exact";
        const mine = new Set(a.distinctive);
        const theirs = new Set(b.distinctive);
        // A name made only of generic words ("Stealth Startup") has nothing to match on but its full key.
        if(!mine.size || !theirs.size) return null;
        const shared = [...mine].filter((token) => theirs.has(token));
        if(!shared.length) return null;
        // Strong needs the same set, not one inside the other: "Epic" sits inside "Epic Games" but is Epic Systems.
        const identical = mine.size === theirs.size && shared.length === mine.size;
        // Two-letter overlaps are coincidence as often as not ("GE" and "GE Inc").
        const substantive = shared.some((token) => token.length >= 3);
        return identical && substantive ? "strong" : "weak";
      }

    // A LinkedIn people search for the company, filtered to 2nd-degree connections. Nothing here opens it; it's a link
    // for you to open in your own browser, since the export only has 1st-degree connections.
    secondDegreeSearch(company)
      {
        const words = encodeURIComponent(String(company || "").trim());
        return `https://www.linkedin.com/search/results/people/?keywords=${words}&network=%5B%22S%22%5D`;
      }
  }
