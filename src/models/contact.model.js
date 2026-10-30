import mongoose from "mongoose";

// career-ops' contact types (contacts.mjs), in our spelling. The contact finder suggests the first three. interviewer
// and internal_referral come from you, and other is anything else.
export const CONTACT_KINDS = ["hiring_manager", "recruiter", "alumni", "peer", "interviewer", "internal_referral", "other"];

// Where a saved contact came from: a contact-finder run you accepted, or your LinkedIn connections.
export const CONTACT_SOURCES = ["run", "linkedin"];

const text = (max) => ({ type: String, default: "", trim: true, maxlength: max });

// The people you've said yes to: career-ops' saved-contacts phonebook (data/contacts.tsv), kept in Mongo. Its columns
// are name, company, type, title, phone, email, linkedin, tracker# and notes. Ours drops phone (nothing here finds
// one), turns tracker# into the jobs this person is saved for, and keeps the proof the finder checked.
//
// One record per person per company, the way career-ops updates a row in place by name and company: key is both,
// folded (see TextKey), so saving Sam at Apple again updates Sam instead of adding a second Sam.
const contactSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    name: { ...text(200), required: [true, "A contact needs a name."] },
    company: { ...text(120), required: [true, "A contact needs a company."] },
    // The company folded, and its distinctive words, for the warm-lead lookup (see CompanyMatch).
    companyKey: { type: String, required: true, index: true },
    companyWords: { type: [String], index: true },
    type: { type: String, enum: { values: CONTACT_KINDS, message: "{VALUE} isn't a kind of contact." }, default: "other" },
    title: text(200),
    location: text(200),
    email: text(200),
    // Their LinkedIn profile, or whatever page proved who they are.
    link: text(2000),
    // The words from that page the finder checked, and why it picked them.
    quote: text(300),
    reason: text(300),
    source: { type: String, enum: CONTACT_SOURCES, default: "run" },
    // When you connected on LinkedIn, "YYYY-MM-DD", for people from your connections.
    connectedOn: text(10),
    // The jobs you've saved this person for. A warm lead is someone saved for a different job at the same company.
    jobs: [{ type: mongoose.Schema.Types.ObjectId, ref: "Job" }],
  },
  {
    timestamps: true,
    toJSON:
      {
        virtuals: true,
        versionKey: false,
        transform: (_, contact) =>
          {
            delete contact._id;
            delete contact.key;
            delete contact.companyKey;
            delete contact.companyWords;
            return contact;
          },
      },
  },
);

contactSchema.index({ jobs: 1 });

export const Contact = mongoose.model("Contact", contactSchema);
