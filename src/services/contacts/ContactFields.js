import { StatusCodes } from "http-status-codes";

// career-ops' contact types (contacts.mjs), in our spelling, same as the contact_kind enum. The contact finder suggests
// the first three. interviewer and internal_referral come from you, and other is anything else.
export const CONTACT_KINDS = ["hiring_manager", "recruiter", "alumni", "peer", "interviewer", "internal_referral", "other"];

// Where a saved contact came from: a contact-finder run you accepted, or your LinkedIn connections.
export const CONTACT_SOURCES = ["run", "linkedin"];

// The most each field holds, the same as the columns.
const CONTACT_LIMITS = { name: 200, company: 120, title: 200, location: 200, email: 200, link: 2000, quote: 300, reason: 300, connectedOn: 10 };
const CONNECTION_LIMITS = { name: 200, company: 200, title: 300, linkedin: 2000, email: 200, connectedOn: 10 };

const failure = (message) => Object.assign(new Error(message), { status: StatusCodes.BAD_REQUEST });

// The checks Mongoose's contact and connection models used to make before saving: text trimmed, name and company
// required, kinds and sources from their lists, nothing past its column.
export class ContactFields
  {
    // A contact about to be saved. Blank fields are dropped, so they don't wipe ones already saved (career-ops'
    // update-in-place).
    forSave({ name, company, source, type, ...rest })
      {
        const clean = { name: this.text("name", name), company: this.text("company", company) };
        if(!clean.name) throw failure("A contact needs a name.");
        if(!clean.company) throw failure("A contact needs a company.");
        for(const [field, value] of Object.entries(rest))
          if(field in CONTACT_LIMITS && this.text(field, value)) clean[field] = this.text(field, value);
        for(const [field, value] of Object.entries(clean))
          if(value.length > CONTACT_LIMITS[field]) throw failure(`${field} can be at most ${CONTACT_LIMITS[field]} characters.`);
        if(type) clean.type = this.oneOf("kind of contact", CONTACT_KINDS, type);
        return { fields: clean, source: this.oneOf("source", CONTACT_SOURCES, source || "run") };
      }

    // A connection from an upload, or null when it can't be kept. Mongoose's upload skipped rows that failed its checks
    // without saying so, and this keeps that.
    forConnection(connection)
      {
        const clean = Object.fromEntries(Object.keys(CONNECTION_LIMITS).map((field) => [field, this.text(field, connection[field], true)]));
        if(!clean.name || !clean.company) return null;
        if(Object.entries(clean).some(([field, value]) => value.length > CONNECTION_LIMITS[field])) return null;
        return clean;
      }

    text(field, value, quiet = false)
      {
        if(value === null || value === undefined) return "";
        if(typeof value === "string") return value.trim();
        if(typeof value === "number") return String(value);
        if(quiet) return "";
        throw failure(`${field} should be a string.`);
      }

    oneOf(label, list, value)
      {
        if(!list.includes(value)) throw failure(`${value} isn't a ${label}.`);
        return value;
      }
  }
