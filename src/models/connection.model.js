import mongoose from "mongoose";

const text = (max) => ({ type: String, default: "", trim: true, maxlength: max });

// Your LinkedIn connections, from the Connections.csv you upload. Each upload replaces the whole list, the same as
// career-ops re-reading the export. They stay out of your saved contacts until you pick one for a job, the way
// career-ops keeps the raw export apart and only the rows you promote reach data/contacts.tsv.
const connectionSchema = new mongoose.Schema(
  {
    name: { ...text(200), required: true },
    company: { ...text(200), required: true },
    title: text(300),
    linkedin: text(2000),
    email: text(200),
    connectedOn: text(10),
    // The company split into folded words (CompanyMatch.tokensOf), worked out once on upload instead of on every
    // lookup.
    tokens:
      {
        all: [String],
        distinctive: [String],
        key: { type: String, index: true },
      },
  },
  {
    timestamps: true,
    toJSON:
      {
        virtuals: true,
        versionKey: false,
        transform: (_, connection) =>
          {
            delete connection._id;
            delete connection.tokens;
            return connection;
          },
      },
  },
);

// The warm-lead lookup looks for connections that share a distinctive word with the job's company.
connectionSchema.index({ "tokens.distinctive": 1 });

export const Connection = mongoose.model("Connection", connectionSchema);
