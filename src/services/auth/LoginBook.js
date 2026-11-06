// Which SleekBoard user a Google (later GitHub, Facebook) login belongs to. After passport/todos-express-google's
// verify function: look the login up in federated_credentials, and if it's new, make a user and link it.
//
// One change from theirs: the owner's account already exists (db:copy made it, with no login linked), so the owner's
// first sign-in links to it instead of making a second, empty one. That link happens once, only for linkableEmail,
// and only while the account has no login at all. An email can change hands, so it's never enough on its own to
// attach a login to an account someone already signs in to.
const PUBLIC_FIELDS = { id: true, email: true, name: true };

export class LoginBook
  {
    constructor({ db, linkableEmail })
      {
        this.db = db;
        this.linkableEmail = String(linkableEmail || "").trim().toLowerCase();
      }

    // The user this login signs in as, or null when it can't have one. Looking up, linking and making all land
    // together or not at all.
    async userFor(account)
      {
        return this.db.$transaction((tx) => this.resolve(tx, account));
      }

    async resolve(tx, account)
      {
        const known = await this.userByLogin(tx, account);
        if(known) return known;
        const existing = account.email() ? await this.userByEmail(tx, account.email()) : null;
        if(!existing) return this.createWith(tx, account);
        if(!(await this.mayLink(tx, existing))) return null;
        await this.link(tx, existing.id, account);
        return existing;
      }

    async userByLogin(tx, account)
      {
        const login = await tx.federatedCredential.findUnique(
          {
            where: { provider_subject: { provider: account.provider(), subject: account.subject() } },
            select: { user: { select: PUBLIC_FIELDS } },
          });
        return login?.user || null;
      }

    async userByEmail(tx, email)
      {
        return tx.user.findUnique({ where: { email }, select: PUBLIC_FIELDS });
      }

    // Only the owner's account, and only before any login is linked to it.
    async mayLink(tx, user)
      {
        if(!this.linkableEmail || user.email !== this.linkableEmail) return false;
        const logins = await tx.federatedCredential.count({ where: { userId: user.id } });
        return logins === 0;
      }

    async link(tx, userId, account)
      {
        await tx.federatedCredential.create({ data: { userId, provider: account.provider(), subject: account.subject() } });
      }

    async createWith(tx, account)
      {
        return tx.user.create(
          {
            data:
              {
                email: account.email() || null,
                name: account.name(),
                logins: { create: { provider: account.provider(), subject: account.subject() } },
              },
            select: PUBLIC_FIELDS,
          });
      }

    // Who a session's user id is, for each request. Null once the user's gone, which signs the session out.
    async find(id)
      {
        if(typeof id !== "string" || !id) return null;
        return this.db.user.findUnique({ where: { id }, select: PUBLIC_FIELDS });
      }
  }
