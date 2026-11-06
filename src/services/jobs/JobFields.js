import { StatusCodes } from "http-status-codes";

// The six lanes, same ids as the client's statuses.js and the lane enum in prisma/schema.prisma. A job outside them is
// a typo, not a new lane.
export const STATUSES = ["saved", "applied", "interviewing", "offer", "rejected", "ghosted"];

// What moved a card: you on the board, or a reply in your inbox.
export const MOVE_SOURCES = ["board", "email"];

// The fields a person can set, with the most each may hold (the same as the columns). Anything else on a request
// body, like an id, an owner or the history, is dropped.
const LIMITS = { company: 120, role: 200, location: 120, status: 0, applied: 10, deadline: 10, link: 2000, contact: 120, email: 200, notes: 5000, logo: 200000 };
export const JOB_FIELDS = Object.keys(LIMITS);

const REQUIRED = { company: "Company is required.", role: "Role is required." };
const DATES = ["applied", "deadline"];

// Dates stay "YYYY-MM-DD" strings, the same as the date inputs give us. Empty means no date. Otherwise the shape has
// to fit and the day has to exist: read as UTC, 2026-02-30 rolls over to 2026-03-02 and no longer matches.
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const failure = (message) => Object.assign(new Error(message), { status: StatusCodes.BAD_REQUEST });

// Checks a job's fields before they're saved, with the same rules and messages Mongoose's job model had: text is
// trimmed, required fields can't be blank, lanes and dates have to be real, and nothing goes past its column.
export class JobFields
  {
    // A new job: company and role have to be there.
    forCreate(body)
      {
        const fields = this.clean(body);
        for(const [field, message] of Object.entries(REQUIRED))
          if(!fields[field]) throw failure(message);
        return fields;
      }

    // Changes to a job: only what was sent, and a required field sent blank is still refused.
    forUpdate(body)
      {
        const fields = this.clean(body);
        for(const [field, message] of Object.entries(REQUIRED))
          if(field in fields && !fields[field]) throw failure(message);
        return fields;
      }

    clean(body = {})
      {
        const sent = JOB_FIELDS.filter((field) => body && field in body);
        return Object.fromEntries(sent.map((field) => [field, this.value(field, body[field])]));
      }

    value(field, raw)
      {
        const text = this.text(field, raw);
        if(field === "status") return this.lane(text);
        if(DATES.includes(field)) return this.day(text);
        if(text.length > LIMITS[field]) throw failure(`${field} can be at most ${LIMITS[field]} characters.`);
        return text;
      }

    // Numbers and true/false become text the way Mongoose cast them; anything else isn't a field value.
    text(field, raw)
      {
        if(raw === null || raw === undefined) return "";
        if(typeof raw === "string") return raw.trim();
        if(typeof raw === "number" || typeof raw === "boolean") return String(raw);
        throw failure(`${field} should be a string.`);
      }

    lane(value)
      {
        if(!STATUSES.includes(value)) throw failure(`${value} isn't a lane.`);
        return value;
      }

    day(value)
      {
        if(value === "") return value;
        if(!DAY.test(value)) throw failure("Dates look like 2026-10-31.");
        const date = new Date(`${value}T00:00:00Z`);
        if(Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw failure(`${value} isn't a real date.`);
        return value;
      }
  }
