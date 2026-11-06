// What the email check remembers between runs: which messages it's handled, which are resting before another try, and
// whether the first look is done.
// JobNavigator keeps the handled ids in a setting (_load_processed_ids and _save_processed_ids in gmail_client.py).
//
// One fix to theirs: they keep "the last 500" by slicing a Python set, which has no order, so recent ids could be
// dropped and those emails read again. Here each id goes on the end and only the newest 500 are kept.
//
// JobNavigator is MIT licensed: Copyright (c) 2026 JobNavigator Contributors.
// https://github.com/vesaias/JobNavigator/blob/main/backend/email_monitor/gmail_client.py

const KEEP = 500;

// The board's shape for the mailbox: what was handled, what's resting (oldest first, as { id, at }), and the login.
const SHAPE = { resting: { orderBy: { at: "asc" } } };

// In Postgres, one mailbox per key per person, like every other table limited to its owner. Each write locks the
// mailbox row first, so two writes can't read the same list and both write it back.
export class MailboxStore
  {
    constructor({ db, userId, key = "me" })
      {
        this.db = db;
        this.userId = userId;
        this.key = key;
      }

    // The mailbox, made the first time it's asked for.
    async get()
      {
        return this.db.$transaction(async (tx) => this.shapeOf(await this.open(tx)));
      }

    // One more message handled. The oldest falls off past 500, and it's no longer resting.
    remember(id)
      {
        return this.changing(async (tx, box) =>
          {
            await tx.mailbox.update({ where: { id: box.id }, data: { processed: [...box.processed, id].slice(-KEEP) } });
            await tx.mailboxResting.deleteMany({ where: { mailboxId: box.id, messageId: id } });
          });
      }

    // A message that couldn't be handled yet, stamped with now so it rests before the next try. Only the newest 500
    // resting ones are kept.
    leave(id)
      {
        return this.changing(async (tx, box) =>
          {
            await tx.mailboxResting.deleteMany({ where: { mailboxId: box.id, messageId: id } });
            await tx.mailboxResting.create({ data: { mailboxId: box.id, messageId: id, at: new Date() } });
            const old = await tx.mailboxResting.findMany({ where: { mailboxId: box.id }, orderBy: { at: "desc" }, skip: KEEP, select: { messageId: true } });
            if(old.length) await tx.mailboxResting.deleteMany({ where: { mailboxId: box.id, messageId: { in: old.map((one) => one.messageId) } } });
          });
      }

    // A new Gmail login, already locked. A new login clears any expired mark, and a different address starts the
    // first look over.
    connect(login, address)
      {
        return this.changing(async (tx, box) =>
          {
            const fresh = box.address !== address;
            if(fresh) await tx.mailboxResting.deleteMany({ where: { mailboxId: box.id } });
            await tx.mailbox.update({ where: { id: box.id }, data: { login, address, connectedAt: new Date(), expired: "", ...(fresh && { processed: [], caughtUp: false }) } });
          });
      }

    // Forgets the Gmail login. What's been handled stays, in case you connect the same inbox again.
    disconnect()
      {
        return this.setting({ login: "", address: "", connectedAt: null, expired: "" });
      }

    // Google refused this login for good.
    markExpired(fingerprint)
      {
        return this.setting({ expired: fingerprint });
      }

    // A check finished. caughtUp is true once one has read everything it found.
    checked(caughtUp)
      {
        return this.setting({ checkedAt: new Date(), ...(caughtUp && { caughtUp: true }) });
      }

    setting(data)
      {
        return this.changing((tx, box) => tx.mailbox.update({ where: { id: box.id }, data }));
      }

    // Opens the mailbox in a transaction, locked, and hands it to `change`.
    changing(change)
      {
        return this.db.$transaction(async (tx) =>
          {
            const box = await this.open(tx);
            // Touching the row locks it until the transaction ends; read it again after, so it's the latest.
            await tx.mailbox.updateMany({ where: { id: box.id }, data: { updatedAt: new Date() } });
            const locked = await tx.mailbox.findUnique({ where: { id: box.id } });
            await change(tx, locked);
          });
      }

    // Everyone with a mailbox, for the email check to go through one by one. The only read here that isn't limited to
    // the current user, since the clock that asks has nobody signed in.
    async owners()
      {
        const rows = await this.db.mailbox.findMany({ where: { key: this.key }, select: { userId: true }, orderBy: { createdAt: "asc" } });
        return rows.map((row) => row.userId);
      }

    // The mailbox row, made if it isn't there yet.
    async open(tx)
      {
        const userId = await this.userId();
        return tx.mailbox.upsert({ where: { userId_key: { userId, key: this.key } }, create: { userId, key: this.key, processed: [] }, update: {}, include: SHAPE });
      }

    shapeOf(row)
      {
        const { userId, resting = [], ...box } = row;
        return { ...box, resting: resting.map((one) => ({ id: one.messageId, at: one.at })) };
      }
  }
