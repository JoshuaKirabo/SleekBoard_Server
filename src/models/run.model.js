import mongoose from "mongoose";

// What a run can be for: finding who to contact about a job, drafting notes to one of them, Fill in, which reads a
// link before its job exists, fills the card and finds the contact, and the email check, which reads your inbox.
export const RUN_KINDS = ["contact", "note", "fill", "email"];

// Kinds of run that belong to no one job.
export const JOBLESS_KINDS = ["fill", "email"];

// queued: waiting for a free slot. running: the agent's on it. done and failed are the two ways it ends.
export const RUN_STATUSES = ["queued", "running", "done", "failed"];

// message: something the model said on its way to a tool. tool: a tool it called. error: a tool that broke.
export const STEP_TYPES = ["message", "tool", "error"];

const stepSchema = new mongoose.Schema(
  {
    type: { type: String, enum: STEP_TYPES, required: true },
    text: { type: String, default: "", maxlength: 1000 },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

// One entry per paid trip, so a run shows what each rung and each search cost. A trip to a model fills in model and
// its tokens. A paid tool, like web_search, fills in tool instead.
const usageSchema = new mongoose.Schema(
  {
    model: { type: String, default: "" },
    tool: { type: String, default: "" },
    input: { type: Number, default: 0 },
    output: { type: Number, default: 0 },
    cost: { type: Number, default: 0 },
  },
  { _id: false },
);

const runSchema = new mongoose.Schema(
  {
    // A fill run starts before its job exists, and gets its job once you press Add to board. An email check has none.
    job: { type: mongoose.Schema.Types.ObjectId, ref: "Job", required: [function() { return !JOBLESS_KINDS.includes(this.kind); }, "A run needs a job."], index: true },
    kind: { type: String, enum: { values: RUN_KINDS, message: "{VALUE} isn't a kind of run." }, required: true },
    status: { type: String, enum: RUN_STATUSES, default: "queued", index: true },
    steps: [stepSchema],
    usage: [usageSchema],
    // The total of usage, kept alongside it so the spending cap can add up a day without opening every run.
    cost: { type: Number, default: 0 },
    // The most this run may spend. The cap counts it in full until the run ends.
    budget: { type: Number, default: 0 },
    // What the run was asked to work on beyond its job. A note run names the contact it writes to, and a fill run the
    // link it reads.
    input:
      {
        contact: { type: mongoose.Schema.Types.ObjectId, ref: "Contact", default: undefined },
        link: { type: String, maxlength: 2000, default: undefined },
      },
    result: { type: mongoose.Schema.Types.Mixed, default: null },
    error: { type: String, default: "" },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    // Same as jobs: the client gets "id", not Mongo's _id and __v.
    toJSON:
      {
        virtuals: true,
        versionKey: false,
        transform: (_, run) =>
          {
            delete run._id;
            return run;
          },
      },
  },
);

// The spending cap adds up today's runs, so finding them by date has to be quick.
runSchema.index({ createdAt: -1 });

export const Run = mongoose.model("Run", runSchema);
