import { lookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import zlib from "node:zlib";
import { PlaceName } from "./PlaceName.js";

// Reads a job posting from its link. Most job sites embed a schema.org JobPosting block so Google can list the role,
// and that block is the best source we have: title, employer, location and closing date, all labelled. When a page
// has none we fall back to its share-preview tags and <title>. Greenhouse's new boards ship neither, so they go
// through Greenhouse's public API instead.

const TIMEOUT = 8000;
const MAX_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 5;

// Some sites hand a bare fetch an empty shell or a 403. Looking like a browser gets the real page.
const HEADERS =
  {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9",
  };

// Job boards where the employer is a tenant. The value says where the tenant's name lives: "sub" for the first label
// of the hostname, a number for that path segment. The name is our best lead on the employer's own domain.
const BOARDS = { "myworkdayjobs.com": "sub", "greenhouse.io": 0, "lever.co": 0, "ashbyhq.com": 0, "workable.com": 0, "smartrecruiters.com": 0, "bamboohr.com": "sub", "recruitee.com": "sub", "breezy.hr": "sub" };

// Sites that list other people's jobs. Their domain is never the employer's.
const AGGREGATORS = ["linkedin.com", "indeed.com", "glassdoor.com", "wellfound.com", "ycombinator.com", "simplify.jobs", "ziprecruiter.com", "monster.com"];

const SUFFIXES = ["com", "io", "ai", "co"];
const DOUBLE_TLD = new Set(["co", "com", "org", "net", "ac", "gov", "edu"]);

export class ReadError extends Error
  {
    constructor(message, status = 502)
      {
        super(message);
        this.status = status;
      }
  }

// ---------- Safety ----------

// The server fetches whatever it's handed, so it must refuse anything that points back inside our own network.
// Every hop of a redirect is checked, not just the first URL.
//
// Node's BlockList does the matching. It understands every spelling of an address, including the IPv4-mapped IPv6
// form that URL parsing turns [::ffff:127.0.0.1] into (::ffff:7f00:1), which a hand-rolled string check misses.
// IPv6 ranges that carry an IPv4 address inside them (NAT64, 6to4, Teredo, the old ::a.b.c.d form) are blocked
// whole: no real job site lives there, and the address they wrap could be anything.
const BLOCKED = new BlockList();
const RANGES =
  [
    ["0.0.0.0", 8, "ipv4"],          // "this network"
    ["10.0.0.0", 8, "ipv4"],         // private
    ["100.64.0.0", 10, "ipv4"],      // carrier-grade NAT
    ["127.0.0.0", 8, "ipv4"],        // loopback
    ["169.254.0.0", 16, "ipv4"],     // link-local, home of cloud metadata
    ["172.16.0.0", 12, "ipv4"],      // private
    ["192.0.0.0", 24, "ipv4"],       // IETF protocol assignments
    ["192.168.0.0", 16, "ipv4"],     // private
    ["198.18.0.0", 15, "ipv4"],      // benchmarking
    ["224.0.0.0", 3, "ipv4"],        // multicast and reserved, up to 255.255.255.255
    ["::", 128, "ipv6"],             // unspecified
    ["::1", 128, "ipv6"],            // loopback
    ["::", 96, "ipv6"],              // IPv4-compatible (::a.b.c.d)
    ["64:ff9b::", 96, "ipv6"],       // NAT64
    ["64:ff9b:1::", 48, "ipv6"],     // local NAT64
    ["100::", 64, "ipv6"],           // discard
    ["2001::", 32, "ipv6"],          // Teredo
    ["2002::", 16, "ipv6"],          // 6to4
    ["fc00::", 7, "ipv6"],           // unique local
    ["fe80::", 10, "ipv6"],          // link-local
    ["fec0::", 10, "ipv6"],          // old site-local
    ["ff00::", 8, "ipv6"],           // multicast
  ];
RANGES.forEach(([network, prefix, family]) => BLOCKED.addSubnet(network, prefix, family));

const isPrivate = (address) =>
  {
    const family = isIP(address);
    if(!family) return true;
    return BLOCKED.check(address, family === 6 ? "ipv6" : "ipv4");
  };

const blocked = () => new ReadError("That link points somewhere we can't read.", 400);

// Checks the link before we connect. A hostname is checked later, at connect time, by safeLookup. A raw IP address
// never goes through a lookup, so it has to be checked here.
const assertPublic = (url) =>
  {
    if(!["http:", "https:"].includes(url.protocol)) throw new ReadError("Only web links can be read.", 400);
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if(isIP(host) && isPrivate(host)) throw blocked();
    return host;
  };

// Stands in for the DNS lookup on every connection we open. Checking the addresses here, as the socket is about to
// use them, is what stops DNS rebinding: a domain can't answer "public" to a check and then "127.0.0.1" to the
// connection, because the check and the connection share one answer.
const safeLookup = (hostname, options, callback) =>
  {
    lookup(hostname, { ...options, all: true }, (error, addresses) =>
      {
        if(error) return callback(error);
        if(!addresses.length || addresses.some(({ address }) => isPrivate(address))) return callback(blocked());
        if(options.all) return callback(null, addresses);
        callback(null, addresses[0].address, addresses[0].family);
      });
  };

const DECODERS = { gzip: zlib.createGunzip, "x-gzip": zlib.createGunzip, deflate: zlib.createInflate, br: zlib.createBrotliDecompress };

// One GET with no redirects followed. Resolves with the response once its headers arrive.
const request = (url, host, signal) => new Promise((resolve, reject) =>
  {
    const client = url.protocol === "https:" ? https : http;
    const req = client.request(
      {
        protocol: url.protocol,
        hostname: host,
        port: url.port || undefined,
        path: url.pathname + url.search,
        headers: { ...HEADERS, "Accept-Encoding": "gzip, deflate, br" },
        lookup: safeLookup,
        agent: false,
        signal,
      }, resolve);
    req.on("error", reject);
    req.end();
  });

// Reads the body up to MAX_BYTES of decoded text. The cap counts bytes after decompression, so a small gzip bomb
// can't balloon past it.
const readBody = async (response) =>
  {
    const decoder = DECODERS[(response.headers["content-encoding"] || "").trim().toLowerCase()];
    const stream = decoder ? response.pipe(decoder()) : response;
    const chunks = [];
    let size = 0;
    try
      {
        for await (const chunk of stream)
          {
            chunks.push(chunk);
            size += chunk.length;
            if(size >= MAX_BYTES) break;
          }
      }
    finally
      {
        response.destroy();
        if(stream !== response) stream.destroy();
      }
    return Buffer.concat(chunks).toString("utf8");
  };

const toReadError = (error, host) =>
  {
    if(error instanceof ReadError) return error;
    if(error.name === "AbortError" || error.name === "TimeoutError") return new ReadError("The page took too long to answer.");
    if(error.code === "ENOTFOUND" || error.code === "EAI_AGAIN") return new ReadError(`Couldn't find ${host}.`, 400);
    return new ReadError("Couldn't reach that page.");
  };

// ---------- Fetching ----------

// Follows redirects by hand so each hop gets the safety check, and stops reading once the page is big enough that
// the useful bits (all in <head> or near the top) are long past. The agent's read_page tool uses it too, and hands in
// its own signal so a page stops loading when the tool's or the run's time is up.
export const fetchPage = async (start, stop) =>
  {
    let url = start;
    for(let hop = 0; hop <= MAX_REDIRECTS; hop++)
      {
        const host = assertPublic(url);
        const signal = stop ? AbortSignal.any([AbortSignal.timeout(TIMEOUT), stop]) : AbortSignal.timeout(TIMEOUT);
        try
          {
            const response = await request(url, host, signal);
            const status = response.statusCode;

            if(status >= 300 && status < 400 && response.headers.location)
              {
                response.destroy();
                url = new URL(response.headers.location, url);
                continue;
              }
            if(status < 200 || status >= 300)
              {
                response.destroy();
                throw new ReadError(`The site wouldn't show us the page (${status}).`);
              }

            return { html: await readBody(response), url, type: response.headers["content-type"] || "" };
          }
        catch(error)
          {
            throw toReadError(error, host);
          }
      }
    throw new ReadError("That link redirects too many times.");
  };

// ---------- Reading the page ----------

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

const decode = (text = "") => text
  .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
  .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match)
  .replace(/<[^>]+>/g, "")
  .replace(/\s+/g, " ")
  .trim();

// Every JobPosting on the page, wherever it's nested: a lone object, an array, or inside an @graph.
const jobPostings = (html) =>
  {
    const found = [];
    const visit = (node) =>
      {
        if(Array.isArray(node)) return node.forEach(visit);
        if(!node || typeof node !== "object") return;
        const type = [].concat(node["@type"] || []);
        if(type.includes("JobPosting")) found.push(node);
        if(node["@graph"]) visit(node["@graph"]);
      };

    for(const [, body] of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi))
      {
        try
          {
            visit(JSON.parse(body.trim()));
          }
        catch
          {
            // A broken block on someone else's page isn't our problem. Skip it and keep looking.
          }
      }
    return found;
  };

const meta = (html, key) =>
  {
    const tag = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, "i"))?.[0];
    return decode(tag?.match(/content=["']([^"']*)["']/i)?.[1]);
  };

const pageTitle = (html) => decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);

// ---------- Cleaning ----------

// Workday names the legal entity that hires you ("2100 NVIDIA USA"), not the brand. Drop the cost-centre number in
// front and the legal or country tail behind, as many times as they stack.
const LEGAL_TAIL = /[\s,]+(inc|llc|l\.l\.c|ltd|limited|corp|corporation|co|gmbh|plc|sa|ag|bv|pty|usa|us|u\.s\.a|u\.s|uk)\.?$/i;

const cleanCompany = (name = "") =>
  {
    let text = decode(name).replace(/^\d+\s+/, "");
    while(LEGAL_TAIL.test(text)) text = text.replace(LEGAL_TAIL, "");
    return text.trim();
  };

const isoDate = (value) =>
  {
    if(!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
  };

// One place, written the way the rest of the board writes it: "City, ST" in the US, the site's own words elsewhere.
// PlaceName does the work, so Workday's country-first "USA - CA - Folsom" and a plain "Santa Clara, California" come
// out the same.
const placeNames = new PlaceName();

const placeName = (place) =>
  {
    const address = place?.address ?? place;
    if(typeof address === "string") return placeNames.format(decode(address));
    if(!address) return "";
    const country = typeof address.addressCountry === "string" ? address.addressCountry : address.addressCountry?.name;
    return placeNames.fromAddress({ locality: decode(String(address.addressLocality || "")), region: decode(String(address.addressRegion || "")), country: decode(String(country || "")) });
  };

const locationOf = (posting) =>
  {
    const places = [].concat(posting.jobLocation || []).map(placeName).filter(Boolean);
    const remote = /telecommute/i.test(posting.jobLocationType || "");
    const first = places[0] || "";
    const more = places.length > 1 ? ` +${places.length - 1}` : "";
    if(remote) return first ? `Remote · ${first}${more}` : "Remote";
    return `${first}${more}`;
  };

// ---------- The employer's domain, for the logo ----------

const rootDomain = (host) =>
  {
    const parts = host.toLowerCase().replace(/^www\./, "").split(".");
    const keep = parts.length > 2 && DOUBLE_TLD.has(parts[parts.length - 2]) && parts[parts.length - 1].length === 2 ? 3 : 2;
    return parts.slice(-keep).join(".");
  };

const boardOf = (host) => Object.keys(BOARDS).find((board) => host === board || host.endsWith(`.${board}`));

// The employer's name as the board knows it, from the subdomain or the path.
const tenantOf = (url) =>
  {
    const board = boardOf(url.hostname);
    if(!board) return "";
    const where = BOARDS[board];
    if(where === "sub") return url.hostname.split(".")[0];
    return url.pathname.split("/").filter(Boolean)[where] || "";
  };

const slugOf = (name) => name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");

// Google's favicon service answers 404 for a domain it has no icon for, which makes it a cheap "is this a real
// company site" check.
const hasFavicon = async (domain) =>
  {
    const response = await fetch(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`, { signal: AbortSignal.timeout(4000) }).catch(() => null);
    return Boolean(response?.ok);
  };

// Best guess at the employer's own site. A domain the posting names wins, then the site the job lives on if that's
// the employer's own, then guesses off the board tenant and the company name, checked against the favicon service.
const findDomain = async ({ url, website, company }) =>
  {
    if(website)
      {
        try
          {
            const domain = rootDomain(new URL(website).hostname);
            if(!boardOf(domain) && !AGGREGATORS.includes(domain)) return domain;
          }
        catch
          {
            // sameAs is free text on some boards. Fall through to the guesses.
          }
      }

    const host = url.hostname;
    const own = rootDomain(host);
    if(!boardOf(host) && !AGGREGATORS.includes(own)) return own;

    const names = [...new Set([slugOf(tenantOf(url)), slugOf(company)].filter(Boolean))];
    const guesses = names.flatMap((name) => SUFFIXES.map((suffix) => `${name}.${suffix}`));
    const hits = await Promise.all(guesses.map(hasFavicon));
    return guesses.find((_, index) => hits[index]) || "";
  };

// ---------- Greenhouse ----------

// New Greenhouse boards render in the browser and carry no JobPosting, but the board's public API has the same facts.
const readGreenhouse = async (url) =>
  {
    if(!url.hostname.endsWith("greenhouse.io")) return null;
    const [board, , id] = url.pathname.split("/").filter(Boolean);
    const jobId = /^\d+$/.test(id || "") ? id : url.searchParams.get("gh_jid");
    if(!board || !jobId) return null;

    const response = await fetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs/${jobId}`, { signal: AbortSignal.timeout(TIMEOUT) }).catch(() => null);
    if(!response?.ok) return null;
    const job = await response.json();
    // Greenhouse boards join several offices with " | " or " • ". Keep the first and count the rest, like the other
    // boards.
    const offices = (job.location?.name || "").split(/[|•]/).map((office) => office.trim()).filter(Boolean);
    const first = placeNames.format(decode(offices[0] || ""));
    return { company: job.company_name || "", role: decode(job.title), location: first ? `${first}${offices.length > 1 ? ` +${offices.length - 1}` : ""}` : "", deadline: "", website: "", source: "greenhouse" };
  };

// ---------- Fallback: preview tags and the tab title ----------

// Titles come as "Role at Company", "Role @ Company", or "Company - Role" with either side first. Whichever side
// matches the board tenant or site name is the company.
const fromTitle = (text, hint) =>
  {
    const at = text.match(/^(?:job application for\s+)?(.+?)\s+(?:at|@)\s+(.+)$/i);
    if(at) return { role: at[1], company: at[2] };

    const sides = text.split(/\s+[-|–—]\s+/);
    if(sides.length >= 2 && hint)
      {
        const first = sides[0];
        const last = sides[sides.length - 1];
        if(slugOf(first).includes(hint) || hint.includes(slugOf(first))) return { company: first, role: sides.slice(1).join(" - ") };
        if(slugOf(last).includes(hint) || hint.includes(slugOf(last))) return { company: last, role: sides.slice(0, -1).join(" - ") };
      }
    return { role: text, company: "" };
  };

const readMeta = (html, url) =>
  {
    const hint = slugOf(tenantOf(url) || rootDomain(url.hostname).split(".")[0]);
    const siteName = meta(html, "og:site_name");
    const title = meta(html, "og:title") || meta(html, "twitter:title") || pageTitle(html);
    if(!title) return null;
    const parsed = fromTitle(title, hint);
    return { company: parsed.company || siteName, role: parsed.role, location: "", deadline: "", website: "", source: "meta" };
  };

const readPosting = (posting) =>
  {
    const org = posting.hiringOrganization || {};
    const found =
      {
        company: typeof org === "string" ? org : org.name || "",
        role: decode(posting.title || posting.identifier?.name || ""),
        location: locationOf(posting),
        deadline: isoDate(posting.validThrough),
        website: [].concat(org.sameAs || org.url || [])[0] || "",
        source: "jobposting",
      };
    return found;
  };

// ---------- Entry ----------

export const readJob = async (link) =>
  {
    let url;
    try
      {
        url = new URL(/^https?:\/\//i.test(link) ? link : `https://${link}`);
      }
    catch
      {
        throw new ReadError("That doesn't look like a link.", 400);
      }

    let found = await readGreenhouse(url);
    if(!found)
      {
        const page = await fetchPage(url);
        url = page.url;
        const posting = jobPostings(page.html)[0];
        found = posting ? readPosting(posting) : readMeta(page.html, url);
      }
    if(!found) throw new ReadError("The page opened but had nothing we could read.", 422);

    const company = cleanCompany(found.company);
    const domain = await findDomain({ url, website: found.website, company });
    return { company, role: found.role, location: found.location, deadline: found.deadline, domain, source: found.source };
  };
