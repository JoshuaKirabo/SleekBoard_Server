import mongoose from "mongoose";

// What a run can be for. Piece 3 brings the first one to life.
export const RUN_KINDS = ["contact"];

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

// One entry per trip to a model, so a run shows what each rung cost.
const usageSchema = new mongoose.Schema(
  {
    model: { type: String, required: true },
    input: { type: Number, default: 0 },
    output: { type: Number, default: 0 },
    cost: { type: Number, default: 0 },
  },
  { _id: false },
);

const runSchema = new mongoose.Schema(
  {
    job: { type: mongoose.Schema.Types.ObjectId, ref: "Job", required: true, index: true },
    kind: { type: String, enum: { values: RUN_KINDS, message: "{VALUE} isn't a kind of run." }, required: true },
    status: { type: String, enum: RUN_STATUSES, default: "queued", index: true },
    steps: [stepSchema],
    usage: [usageSchema],
    // The total of usage, kept alongside it so the spending cap can add up a day without opening every run.
    cost: { type: Number, default: 0 },
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
