import mongoose from "mongoose";

// One connected inbox and what the email check remembers about it. There's one until SleekBoard has accounts; then
// each person's Gmail gets its own, the way JobNavigator keeps gmail_processed_ids per account.
// A reply that couldn't be handled yet, and when it was last tried.
const restingSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    at: { type: Date, default: Date.now },
  },
  { _id: false });

const mailboxSchema = new mongoose.Schema(
  {
    // Which inbox. "me" until there are accounts.
    key: { type: String, required: true, unique: true },
    // The last 500 message ids already handled, oldest first, so nothing is read twice.
    processed: { type: [String], default: [] },
    // Replies that couldn't be handled yet (no card for them, or the AI couldn't read them). Each rests a while before
    // it's tried again.
    resting: { type: [restingSchema], default: [] },
    // False until the first check has read back 90 days without running out of AI reads. After that a check reads 3.
    caughtUp: { type: Boolean, default: false },
    checkedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const Mailbox = mongoose.model("Mailbox", mailboxSchema);
