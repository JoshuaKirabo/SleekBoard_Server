// The 50 states and DC by name, for turning "California" into "CA".
const STATES =
  {
    alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT",
    delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
    indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
    massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE",
    nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC",
    "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
    "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA",
    washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
  };
const CODES = new Set(Object.values(STATES));

// Every way a posting writes the country, dots dropped first, so "U.S.A." counts too.
const US_NAMES = new Set(["us", "usa", "united states", "united states of america", "america"]);

// Georgia is a country as well as a state, so the name alone never makes a place American.
const BOTH_A_COUNTRY = new Set(["georgia"]);

// Canada's provinces. "Toronto, ON, CA" ends in CA for Canada, not California, and the province gives it away.
const PROVINCES = new Set(["ab", "bc", "mb", "nb", "nl", "ns", "nt", "nu", "on", "pe", "qc", "sk", "yt", "alberta", "british columbia", "manitoba", "new brunswick", "newfoundland and labrador", "nova scotia", "ontario", "prince edward island", "quebec", "québec", "saskatchewan", "yukon"]);

// Longest place text read. Real ones are a few words; the cap also keeps the splitting below quick on a crafted page.
const MAX_TEXT = 300;

// Writes a place the same way whatever job site it came from: "City, ST" in the US (Josh, 2026-10-30), so Intel's
// "USA - CA - Folsom", Workday's "US, CA, Santa Clara" and Greenhouse's "San Francisco, California" all come out in
// the same shape as the rest of the board. Places outside the US are kept the way the site wrote them.
export class PlaceName
  {
    // A place as one line of text, like Greenhouse's "San Francisco, California".
    format(text)
      {
        const line = this.clean(text);
        if(/remote/i.test(line)) return line;
        return this.written(this.partsOf(line), "");
      }

    // A place as a JobPosting address, with the town, state and country in fields of their own.
    fromAddress({ locality = "", region = "", country = "" } = {})
      {
        const parts = this.partsOf(this.clean(locality));
        const state = this.clean(region);
        if(state && !parts.some((part) => this.sameRegion(part, state))) parts.push(state);
        return this.written(parts, this.clean(country));
      }

    // The pieces of a place, split on commas and on Workday's " - ".
    partsOf(text)
      {
        return text.split(/,|\s[-–—]\s/).map((part) => part.trim()).filter(Boolean);
      }

    written(parts, country)
      {
        const { places, country: found } = this.unflipped(parts, country);
        if(!places.length) return found;
        if(!this.isUs(places, found)) return this.joined(places);
        return this.usPlace(places.filter((part) => !this.isUsName(part)));
      }

    // Workday puts the country first ("USA - CA - Folsom"), so a leading country code turns the list around, city
    // first. A country at the end ("Folsom, CA, United States") comes off the end instead.
    unflipped(parts, country)
      {
        const [first] = parts;
        if(parts.length > 1 && (this.isUsName(first) || /^[A-Z]{2}$/.test(first))) return { places: parts.slice(1).reverse(), country: first };
        if(parts.length > 1 && this.isUsName(parts.at(-1))) return { places: parts.slice(0, -1), country: parts.at(-1) };
        return { places: parts, country };
      }

    // American when the posting says so, or, with no country given, when it ends in a state and names no province.
    isUs(places, country)
      {
        if(country) return this.isUsName(country);
        const last = places.at(-1);
        if(places.some((part) => PROVINCES.has(part.toLowerCase()))) return false;
        return Boolean(this.stateCode(last)) && !BOTH_A_COUNTRY.has(last.toLowerCase());
      }

    // The town and its state's code. Anything between them, like a county, drops out.
    usPlace(places)
      {
        const codes = places.map((part) => this.stateCode(part));
        const at = codes.findLastIndex(Boolean);
        if(at === -1) return this.joined(places);
        return at > 0 ? `${places[0]}, ${codes[at]}` : codes[at];
      }

    // Outside the US, the site's own words, with repeats like "Singapore, Singapore" collapsed.
    joined(places)
      {
        return places.filter((part, index) => part !== places[index - 1]).join(", ");
      }

    stateCode(text)
      {
        if(!text) return "";
        if(text.length === 2 && CODES.has(text.toUpperCase())) return text.toUpperCase();
        return STATES[text.toLowerCase()] || "";
      }

    sameRegion(part, region)
      {
        if(part.toLowerCase() === region.toLowerCase()) return true;
        const code = this.stateCode(region);
        return Boolean(code) && this.stateCode(part) === code;
      }

    isUsName(text)
      {
        return US_NAMES.has(String(text || "").toLowerCase().replaceAll(".", "").trim());
      }

    clean(text)
      {
        return typeof text === "string" ? text.slice(0, MAX_TEXT).replace(/\s+/g, " ").trim() : "";
      }
  }
