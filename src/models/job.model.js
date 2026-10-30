import mongoose from "mongoose";

// The six lanes, same ids as the client's statuses.js. A job outside them is a typo, not a new lane.
export const STATUSES = ["saved", "applied", "interviewing", "offer", "rejected", "ghosted"];

// The fields a person can set. Controllers copy only these off a request body, so nobody can post their own _id or
// timestamps.
export const JOB_FIELDS = ["company", "role", "location", "status", "applied", "deadline", "link", "contact", "email", "notes", "logo"];

// Dates stay "YYYY-MM-DD" strings, the same as the date inputs give us. A Date would get shifted by time zones and
// show the 14th as the 13th for anyone west of UTC.
// Empty means no date. Otherwise the shape has to fit and the day has to exist: read as UTC, 2026-02-30 rolls over to
// 2026-03-02 and no longer matches, while 2028-02-29 comes back as itself.
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (value) =>
  {
    if(value === "") return true;
    if(!DAY.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
const dayMessage = ({ value }) => DAY.test(value) ? `${value} isn't a real date.` : "Dates look like 2026-10-31.";
const day = { type: String, default: "", validate: { validator: isDay, message: dayMessage } };
const text = { type: String, default: "", trim: true };
const lane = { type: String, enum: { values: STATUSES, message: "{VALUE} isn't a lane." } };

// What moved a card: you on the board, or a reply in your inbox.
export const MOVE_SOURCES = ["board", "email"];

// One lane change, JobNavigator's status_transitions entry (backend/models/db.py). Undo takes the last one off, so a
// misclick and its undo leave no trace.
const moveSchema = new mongoose.Schema(
  {
    from: lane,
    to: lane,
    at: { type: Date, default: Date.now },
    source: { type: String, enum: MOVE_SOURCES, required: true },
  },
  { _id: false });

// A reply the AI wasn't sure enough about to act on: the lane it thinks the card belongs in, waiting for you to say
// yes or no.
const replySuggestionSchema = new mongoose.Schema(
  {
    to: { ...lane, required: true },
    confidence: { type: Number, min: 0, max: 100 },
    at: { type: Date, default: Date.now },
  },
  { _id: false });

const jobSchema = new mongoose.Schema(
  {
    company: { type: String, required: [true, "Company is required."], trim: true, maxlength: 120 },
    role: { type: String, required: [true, "Role is required."], trim: true, maxlength: 200 },
    location: { ...text, maxlength: 120 },
    status: { type: String, enum: { values: STATUSES, message: "{VALUE} isn't a lane." }, default: "saved" },
    applied: day,
    deadline: day,
    link: { ...text, maxlength: 2000 },
    contact: { ...text, maxlength: 120 },
    email: { ...text, maxlength: 200 },
    notes: { ...text, maxlength: 5000 },
    // A favicon URL, or a data URL when you uploaded one. Uploads are shrunk to 128px on the client, so 200KB is
    // plenty of room.
    logo: { type: String, default: "", maxlength: 200000 },
    // Every lane change, oldest first.
    moves: { type: [moveSchema], default: [] },
    // The last reply tied to this card: when it was read and its first 200 characters, like JobNavigator's
    // last_email_received and last_email_snippet.
    replyAt: { type: Date, default: null },
    replySnippet: { type: String, default: "", maxlength: 200 },
    replySuggestion: { type: replySuggestionSchema, default: null },
  },
  {
    timestamps: true,
    // The client knows jobs by "id". Send that and leave Mongo's _id and __v behind.
    toJSON:
      {
        virtuals: true,
        versionKey: false,
        transform: (_, job) =>
          {
            delete job._id;
            return job;
          },
      },
  },
);

export const Job = mongoose.model("Job", jobSchema);
