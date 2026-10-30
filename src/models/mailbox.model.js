import mongoose from "mongoose";

// One connected inbox and what the email check remembers about it. There's one until SleekBoard has accounts; then
// each person's Gmail gets its own, the way JobNavigator keeps gmail_processed_ids per account.
const mailboxSchema = new mongoose.Schema(
  {
    // Which inbox. "me" until there are accounts.
    key: { type: String, required: true, unique: true },
    // The last 500 message ids already handled, oldest first, so nothing is read twice.
    processed: { type: [String], default: [] },
    // False until the first check has read back 90 days with nothing left over. After that a check reads 3 days.
    caughtUp: { type: Boolean, default: false },
    checkedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const Mailbox = mongoose.model("Mailbox", mailboxSchema);
