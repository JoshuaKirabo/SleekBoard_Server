import { randomBytes } from "node:crypto";
import { TextKey } from "./TextKey.js";
import { CompanyMatch } from "./CompanyMatch.js";
import { ContactFields } from "./ContactFields.js";

// The board's shape for a contact: its fields and the ids of the jobs it's saved for. The lookup keys and the owner
// stay in here.
const SHAPE = { jobs: { select: { jobId: true }, orderBy: { jobId: "asc" } } };

// Every read and write of saved contacts, in Postgres, limited to one person's: userId is asked for on each call, the
// same as JobStore. Links between a contact and a job carry the owner too, so Postgres refuses one across two people.
export class ContactBook
  {
    constructor({ db, userId, keys = new TextKey(), match = new CompanyMatch({ keys }), fields = new ContactFields() })
      {
        this.db = db;
        this.userId = userId;
        this.keys = keys;
        this.match = match;
        this.fields = fields;
      }

    // career-ops' contact id: name and company, both folded, so the same person at the same company is one record.
    keyOf(name, company)
      {
        return `${this.nameKeyOf(name)}::${this.keys.key(company)}`;
      }

    nameKeyOf(name)
      {
        return this.keys.key(name);
      }

    // The company's key for the warm-lead lookup. career-ops' contact-lookup.mjs only folds case and punctuation, so
    // someone saved at "Stripe" never turned up for a job at "Stripe Inc.". FEATURES.md (agreed with Josh) asks for
    // filler words to be ignored too, so this uses linkedin-join's matching, the same as connections: exact and
    // strong count, never part of a word.
    companyKeyOf(company)
      {
        return this.match.tokensOf(company).key;
      }

    // The company's distinctive words, kept on each contact so the lookup can find strong matches.
    companyWordsOf(company)
      {
        return this.match.tokensOf(company).distinctive;
      }

    // Saves a person for a job, or updates them in place if they're already saved at that company, the freshest copy
    // winning like career-ops' update-in-place. Blank fields don't wipe ones already saved, and where they came from
    // is only set the first time. New contacts get a Mongo-style id while runs, which name a note run's contact, are
    // still in Mongo.
    async save(input, jobId)
      {
        const userId = await this.userId();
        const { fields, source } = this.fields.forSave(input);
        const key = this.keyOf(fields.name, fields.company);
        const looked = { companyKey: this.companyKeyOf(fields.company), companyWords: this.companyWordsOf(fields.company) };
        return this.db.$transaction(async (tx) =>
          {
            const contact = await tx.contact.upsert(
              {
                where: { userId_key: { userId, key } },
                create: { ...fields, ...looked, id: randomBytes(12).toString("hex"), userId, key, source },
                update: { ...fields, ...looked },
              });
            if(jobId) await tx.contactJob.createMany({ data: [{ contactId: contact.id, jobId: String(jobId), userId }], skipDuplicates: true });
            return this.shapeOf(await tx.contact.findUnique({ where: { id: contact.id }, include: SHAPE }));
          });
      }

    async find(id)
      {
        if(!id) return null;
        const row = await this.db.contact.findFirst({ where: { id: String(id), userId: await this.userId() }, include: SHAPE });
        return row && this.shapeOf(row);
      }

    // The people saved for this job, most recently touched first.
    async forJob(jobId)
      {
        const rows = await this.db.contact.findMany({ where: { userId: await this.userId(), jobs: { some: { jobId: String(jobId) } } }, include: SHAPE, orderBy: { updatedAt: "desc" } });
        return rows.map((row) => this.shapeOf(row));
      }

    // Warm leads: people saved for other jobs at the same company, newest first, as career-ops lists them. Each says
    // how its company matched, so the card can show both names when they differ.
    async atCompany(company, jobId)
      {
        const target = this.match.tokensOf(company);
        if(!target.key) return [];
        const sameCompany = [{ companyKey: target.key }, ...(target.distinctive.length ? [{ companyWords: { hasSome: target.distinctive } }] : [])];
        const found = await this.db.contact.findMany(
          {
            where: { userId: await this.userId(), jobs: { none: { jobId: String(jobId) } }, OR: sameCompany },
            include: SHAPE,
            orderBy: { updatedAt: "desc" },
            take: 200,
          });
        return found
          .map((row) => ({ row, tier: this.match.tier(this.match.tokensOf(row.company), target) }))
          .filter(({ tier }) => tier === "exact" || tier === "strong")
          .slice(0, 20)
          .map(({ row, tier }) => ({ ...this.shapeOf(row), match: tier }));
      }

    // Saves a contact you already have for one more job. null when there's no such contact.
    async link(id, jobId)
      {
        const userId = await this.userId();
        return this.touching(id, userId, (tx, contactId) => tx.contactJob.createMany({ data: [{ contactId, jobId: String(jobId), userId }], skipDuplicates: true }));
      }

    // Takes a contact off one job. They stay saved. null when there's no such contact.
    async unlink(id, jobId)
      {
        const userId = await this.userId();
        return this.touching(id, userId, (tx, contactId) => tx.contactJob.deleteMany({ where: { contactId, jobId: String(jobId), userId } }));
      }

    // Changes a contact's links and marks it touched, so it comes up first like before. null when it isn't there.
    async touching(id, userId, change)
      {
        return this.db.$transaction(async (tx) =>
          {
            const { count } = await tx.contact.updateMany({ where: { id: String(id), userId }, data: { updatedAt: new Date() } });
            if(!count) return null;
            await change(tx, String(id));
            return this.shapeOf(await tx.contact.findUnique({ where: { id: String(id) }, include: SHAPE }));
          });
      }

    shapeOf(row)
      {
        const { userId, key, companyKey, companyWords, jobs = [], ...contact } = row;
        return { ...contact, jobs: jobs.map((link) => link.jobId) };
      }
  }
