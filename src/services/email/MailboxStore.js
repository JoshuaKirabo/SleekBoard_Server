// What the email check remembers between runs: which messages it's handled and whether the first look is done.
// JobNavigator keeps the handled ids in a setting (_load_processed_ids and _save_processed_ids in gmail_client.py).
//
// One fix to theirs: they keep "the last 500" by slicing a Python set, which has no order, so recent ids could be
// dropped and those emails read again. Here each id is pushed on the end and Mongo keeps the newest 500.
//
// JobNavigator is MIT licensed: Copyright (c) 2026 JobNavigator Contributors.
// https://github.com/vesaias/JobNavigator/blob/main/backend/email_monitor/gmail_client.py

const KEEP = 500;

export class MailboxStore
  {
    constructor({ Mailbox, key = "me" })
      {
        this.Mailbox = Mailbox;
        this.key = key;
      }

    // The mailbox, made the first time it's asked for.
    get()
      {
        return this.Mailbox.findOneAndUpdate({ key: this.key }, { $setOnInsert: { key: this.key } }, { upsert: true, new: true });
      }

    // One more message handled. The oldest falls off past 500.
    remember(id)
      {
        return this.Mailbox.updateOne({ key: this.key }, { $push: { processed: { $each: [id], $slice: -KEEP } } });
      }

    // A check finished. caughtUp is true once one has read everything it found.
    checked(caughtUp)
      {
        return this.Mailbox.updateOne({ key: this.key }, { $set: { checkedAt: new Date(), ...(caughtUp && { caughtUp: true }) } });
      }
  }
