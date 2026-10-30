import { PlaceName } from "../../services/PlaceName.js";

const FIELD_MAX = 200;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// Tries, refused ones included, so a model that copies a field wrong can fix it.
const TRIES = 3;

// The fill_job tool: the job's details off its posting, each one checked against what this run actually read, the
// same way suggest_contact checks a person. The location goes through PlaceName, so it reads "City, ST" however the
// model wrote it. Once accepted, onFilled puts the details on the run straight away, so the add sheet can show them
// while the contact search carries on.
export class FillJob
  {
    constructor({ seen, onFilled })
      {
        this.seen = seen;
        this.onFilled = onFilled;
        this.places = new PlaceName();
        this.job = null;
        this.perRun = TRIES;
        this.name = "fill_job";
        this.description = "Fill in the job's card from its posting. Every field has to be written the way the posting writes it, on the page you read for it. Call it once, before looking for a contact.";
        this.parameters =
          {
            type: "object",
            properties:
              {
                link: { type: "string", description: "The posting's link, exactly as read_page gave it." },
                company: { type: "string", description: "The employer, as the posting names it." },
                role: { type: "string", description: "The job title, as the posting writes it." },
                location: { type: "string", description: "Where the job is, as the posting writes it, or \"\" if it doesn't say." },
                deadline: { type: "string", description: "The closing date as YYYY-MM-DD, or \"\" if the posting gives none." },
              },
            required: ["link", "company", "role", "location", "deadline"],
          };
      }

    async run(args)
      {
        const fields = this.fieldsFrom(args);
        this.ensureProof(fields);
        this.job = { ...fields, location: this.places.offices(fields.location), link: this.seen.linkOf(fields.link) };
        await this.onFilled?.(this.job);
        const place = this.job.location ? ` in ${this.job.location}` : "";
        return `Filled in ${this.job.role} at ${this.job.company}${place}. Now find the contact, for this office.`;
      }

    fieldsFrom(args)
      {
        const fields =
          {
            link: this.text(args, "link", 2_000),
            company: this.text(args, "company", FIELD_MAX),
            role: this.text(args, "role", FIELD_MAX),
            location: this.text(args, "location", FIELD_MAX),
            deadline: this.text(args, "deadline", 10),
          };
        for(const key of ["link", "company", "role"])
          {
            if(!fields[key]) throw new Error(`fill_job needs ${key}.`);
          }
        if(fields.deadline && !this.isDay(fields.deadline)) throw new Error("deadline has to be a real date as YYYY-MM-DD, or \"\".");
        return fields;
      }

    text(args, key, max)
      {
        const value = typeof args?.[key] === "string" ? args[key].trim() : "";
        if(value.length > max) throw new Error(`${key} is ${value.length} characters. Keep it under ${max}.`);
        return value;
      }

    isDay(value)
      {
        if(!DAY.test(value)) return false;
        const date = new Date(`${value}T00:00:00Z`);
        return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
      }

    // Company, role and place all have to be on the page the link points to, as whole words.
    ensureProof({ link, company, role, location })
      {
        if(!this.seen.has(link)) throw new Error("That link isn't a page you read in this run. Read the posting with read_page first.");
        if(!this.seen.shows(link, company)) throw new Error(`"${company}" isn't on that page. Write the company the way the posting does.`);
        if(!this.seen.shows(link, role)) throw new Error(`"${role}" isn't on that page. Copy the job title the way the posting writes it.`);
        if(location && !this.seen.shows(link, location)) throw new Error(`"${location}" isn't on that page. Write the place the way the posting does, or "".`);
      }
  }
