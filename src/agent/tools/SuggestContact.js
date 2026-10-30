// The kinds of contact, in the order the playbook looks for them (Josh, 2026-10-30): a recruiter, the hiring manager,
// two engineers from your school, and teammates when no alumni can be confirmed. career-ops looks for one hiring
// manager first; Josh wants all of these, about five people.
export const CONTACT_TYPES = ["recruiter", "hiring_manager", "alumni", "peer"];

// How many of each kind one run keeps, so the model can't fill every slot with the easiest kind to find.
export const PER_TYPE = { recruiter: 1, hiring_manager: 1, alumni: 2, peer: 2 };

export const MAX_CONTACTS = 5;

// Tries, refused ones included. Toolbox counts every call, so this leaves room for a model that gets a few quotes
// wrong, while the caps above are what limit the result.
const TRIES = 10;

// Counted after SeenText flattens it, so padding like "______" can't make a two-letter quote look long (#30).
const QUOTE_MIN = 15;
const QUOTE_MAX = 300;
const FIELD_MAX = 200;
const REASON_MAX = 300;

// Written when the page doesn't say where the person is.
const UNKNOWN = "unknown";

// On a page about several people, like a team page, the name has to be this close to the quote, so the two are
// about the same person (#30). A LinkedIn profile is about one person, so it's exempt.
const NEAR = 300;

// A full name: at least two words and four letters, so "Sam" or "J" can't match half a page (#30).
const NAME_WORDS = 2;
const NAME_MIN = 4;

// The suggest_contact tool. The model hands over one person and the proof, and this checks the proof against what the
// run's tools actually returned (SeenText) before keeping them. A contact it refuses comes back to the model as an
// error it can fix. Nothing is saved anywhere but the run's result: Josh accepts or rejects it on the card, the way
// career-ops never saves a contact before the candidate confirms.
export class SuggestContact
  {
    // schools are the user's schools, for alumni. With none saved, nobody can be alumni.
    constructor({ seen, maxContacts = MAX_CONTACTS, schools = [] })
      {
        this.seen = seen;
        this.maxContacts = maxContacts;
        this.schools = schools;
        this.contacts = [];
        this.perRun = TRIES;
        this.name = "suggest_contact";
        this.description = `Save one person as a suggested contact for this job. The link has to be a search result or page a tool gave you in this run, and the quote has to be copied word for word from it, showing they work at the company now. At most ${maxContacts} people.`;
        this.parameters =
          {
            type: "object",
            properties:
              {
                name: { type: "string", description: "Their full name, exactly as the page shows it." },
                title: { type: "string", description: "Their job title now." },
                type: { type: "string", enum: CONTACT_TYPES, description: "recruiter hires for this kind of role, hiring_manager leads the team, alumni is an engineer there who went to the user's school, peer works on the team in a similar role." },
                location: { type: "string", description: `Where they're based, written the way the page writes it, or "${UNKNOWN}".` },
                link: { type: "string", description: "The page that proves it: the search result's link or the page you read, exactly as the tool gave it." },
                quote: { type: "string", description: `Words copied exactly from that page that show their role at the company, ${QUOTE_MIN} to ${QUOTE_MAX} characters.` },
                reason: { type: "string", description: "One sentence on why this person, for this role and this office." },
              },
            required: ["name", "title", "type", "location", "link", "quote", "reason"],
          };
      }

    // The link that's kept is the one the tool gave for that page, not the model's copy of it, so the card never gets
    // a javascript: link or someone else's lookalike (#29).
    async run(args)
      {
        const contact = this.contactFrom(args);
        this.ensureRoom(contact);
        this.ensureProof(contact);
        this.ensureSchool(contact);
        const kept = { ...contact, link: this.seen.linkOf(contact.link) };
        this.contacts.push(kept);
        return this.saved(kept);
      }

    // Every field as trimmed text, with the shape checked before the proof is.
    contactFrom(args)
      {
        const contact =
          {
            name: this.field(args, "name", FIELD_MAX),
            title: this.field(args, "title", FIELD_MAX),
            type: this.field(args, "type", FIELD_MAX),
            location: this.field(args, "location", FIELD_MAX),
            link: this.field(args, "link", 2_000),
            quote: this.field(args, "quote", QUOTE_MAX),
            reason: this.field(args, "reason", REASON_MAX),
          };
        if(!CONTACT_TYPES.includes(contact.type)) throw new Error(`type has to be one of ${CONTACT_TYPES.join(", ")}.`);
        if(this.seen.flatten(contact.quote).length < QUOTE_MIN) throw new Error(`That quote is too short to prove anything. Copy at least ${QUOTE_MIN} characters of words.`);
        if(!this.isFullName(contact.name)) throw new Error("Write their full name, first and last, as the page shows it.");
        return contact;
      }

    isFullName(name)
      {
        const flat = this.seen.flatten(name);
        return flat.split(" ").length >= NAME_WORDS && flat.replace(/[^\p{L}]/gu, "").length >= NAME_MIN;
      }

    field(args, key, max)
      {
        const value = typeof args?.[key] === "string" ? args[key].trim() : "";
        if(!value) throw new Error(`suggest_contact needs ${key}.`);
        if(value.length > max) throw new Error(`${key} is ${value.length} characters. Keep it under ${max}.`);
        return value;
      }

    ensureRoom(contact)
      {
        if(this.contacts.length >= this.maxContacts) throw new Error(`You've already suggested ${this.maxContacts} people. Finish with your answer.`);
        const same = this.contacts.find((saved) => this.seen.flatten(saved.name) === this.seen.flatten(contact.name) || this.seen.keyOf(saved.link) === this.seen.keyOf(contact.link));
        if(same) throw new Error(`You already suggested ${same.name}.`);
        const ofType = this.contacts.filter((saved) => saved.type === contact.type).length;
        if(ofType >= PER_TYPE[contact.type]) throw new Error(`You already have ${PER_TYPE[contact.type]} ${contact.type} contact${PER_TYPE[contact.type] > 1 ? "s" : ""}. Look for a different kind, or finish.`);
      }

    // The link, the quote, the name and the place all have to come from the same page, and a page that only repeats
    // its own link back doesn't count.
    ensureProof({ link, quote, name, location })
      {
        if(!this.seen.has(link)) throw new Error("That link didn't come from a search result or a page you read in this run. Use a link exactly as a tool gave it.");
        const page = this.seen.linkOf(link);
        if(this.seen.echoes(link, name) || this.seen.echoes(link, quote)) throw new Error("That page repeats the words in its own link, so it can't prove anyone works there. Use a profile or a page about the team.");
        if(!this.seen.shows(link, quote)) throw new Error(`That quote isn't on ${page}. Copy the words exactly as that page shows them.`);
        if(!this.seen.shows(link, name)) throw new Error(`${name} isn't named on that page. Never guess a name.`);
        if(!this.seen.isProfile(link) && !this.seen.near(link, name, quote, NEAR)) throw new Error(`${name} has to be named within ${NEAR} characters of the quote, so they're about the same person.`);
        if(location.toLowerCase() !== UNKNOWN && !this.seen.shows(link, location)) throw new Error(`"${location}" isn't on that page. Write the place the way the page does, or "${UNKNOWN}".`);
      }

    // Alumni have to have one of the user's schools on their own page, the same way a quote has to be there.
    ensureSchool({ type, link })
      {
        if(type !== "alumni") return;
        if(!this.schools.length) throw new Error("The user hasn't saved a school, so nobody can be alumni. Use peer for someone on the team.");
        if(!this.schools.some((school) => this.seen.shows(link, school))) throw new Error(`That page doesn't show ${this.schools.join(" or ")}, so they can't be alumni. Use peer if they're on the team.`);
      }

    saved(contact)
      {
        const count = this.contacts.length;
        const next = count < this.maxContacts ? "Keep going down the list for the kinds you don't have yet, or finish if you're out of searches." : "That's the most. Finish with your answer.";
        return `Saved ${contact.name} as suggestion ${count} of ${this.maxContacts}. ${next}`;
      }
  }
