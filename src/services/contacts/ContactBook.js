import { TextKey } from "./TextKey.js";
import { CompanyMatch } from "./CompanyMatch.js";

// Every read and write of saved contacts. It gets the Mongoose model handed in, like RunStore, so tests can hand it a
// stand-in.
export class ContactBook
  {
    constructor({ Contact, keys = new TextKey(), match = new CompanyMatch({ keys }) })
      {
        this.Contact = Contact;
        this.keys = keys;
        this.match = match;
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
    // is only set the first time.
    save({ name, company, source, ...fields }, jobId)
      {
        const filled = Object.fromEntries(Object.entries(fields).filter(([, value]) => value));
        const update =
          {
            $set: { name, company, companyKey: this.companyKeyOf(company), companyWords: this.companyWordsOf(company), ...filled },
            $setOnInsert: { source },
            $addToSet: { jobs: jobId },
          };
        return this.Contact.findOneAndUpdate({ key: this.keyOf(name, company) }, update, { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true });
      }

    find(id)
      {
        return this.Contact.findById(id);
      }

    // The people saved for this job, most recently touched first.
    forJob(jobId)
      {
        return this.Contact.find({ jobs: jobId }).sort({ updatedAt: -1 });
      }

    // Warm leads: people saved for other jobs at the same company, newest first, as career-ops lists them. Each says
    // how its company matched, so the card can show both names when they differ.
    async atCompany(company, jobId)
      {
        const target = this.match.tokensOf(company);
        if(!target.key) return [];
        const found = await this.Contact.find({ jobs: { $ne: jobId }, $or: [{ companyKey: target.key }, { companyWords: { $in: target.distinctive } }] }).sort({ updatedAt: -1 }).limit(200);
        return found
          .map((contact) => ({ contact, tier: this.match.tier(this.match.tokensOf(contact.company), target) }))
          .filter(({ tier }) => tier === "exact" || tier === "strong")
          .slice(0, 20)
          .map(({ contact, tier }) => ({ ...contact.toJSON(), match: tier }));
      }

    // Gives back null when there's no such contact.
    link(id, jobId)
      {
        return this.Contact.findByIdAndUpdate(id, { $addToSet: { jobs: jobId } }, { new: true });
      }

    unlink(id, jobId)
      {
        return this.Contact.findByIdAndUpdate(id, { $pull: { jobs: jobId } }, { new: true });
      }

    // A deleted job comes off everyone it was saved on. The people stay, since they might be a warm lead later.
    dropJob(jobId)
      {
        return this.Contact.updateMany({ jobs: jobId }, { $pull: { jobs: jobId } });
      }
  }
