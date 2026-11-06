import { UserSessions } from "./UserSessions.js";

// Which SleekBoard user a Google (later GitHub, Facebook) login belongs to. After passport/todos-express-google's
// verify function: look the login up in federated_credentials, and if it's new, make a user and link it.
//
// One change from theirs: a login whose email already has an account links to it, once, while that account has no
// login at all. That's the owner's account db:copy made, or one made with a password at sign-up. A second login with
// the same email is refused, since an email can change hands.
//
// Linking follows better-auth's link-account.ts: only an email Google has checked (SignInGate), and it trusts the
// account's own password only if that email was confirmed too. A password on an unconfirmed email may be a stranger's
// who signed up with it first, so it's wiped and their browsers signed out, the way Formbricks clears an unverified
// password when the email's owner arrives through Google. The account counts as confirmed from then on.
const PUBLIC_FIELDS = { id: true, email: true, name: true };
const LINK_FIELDS = { ...PUBLIC_FIELDS, emailVerified: true };

export class LoginBook
  {
    constructor({ db })
      {
        this.db = db;
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
        if(!existing.emailVerified) await this.claim(tx, existing.id);
        await this.link(tx, existing.id, account);
        return this.publicOf(existing);
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
        return tx.user.findUnique({ where: { email }, select: LINK_FIELDS });
      }

    // Only before any login is linked to it.
    async mayLink(tx, user)
      {
        const logins = await tx.federatedCredential.count({ where: { userId: user.id } });
        return logins === 0;
      }

    // The email's owner has arrived through Google: wipe a password nobody confirmed, sign out every browser on it, and
    // count the email as confirmed.
    async claim(tx, userId)
      {
        await new UserSessions({ db: tx }).endAll(userId);
        await tx.user.update({ where: { id: userId }, data: { passwordHash: null, emailVerified: true } });
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
                emailVerified: true,
                logins: { create: { provider: account.provider(), subject: account.subject() } },
              },
            select: PUBLIC_FIELDS,
          });
      }

    publicOf(user)
      {
        return { id: user.id, email: user.email, name: user.name };
      }

    // Who a session's user id is, for each request. Null once the user's gone, which signs the session out.
    async find(id)
      {
        if(typeof id !== "string" || !id) return null;
        return this.db.user.findUnique({ where: { id }, select: PUBLIC_FIELDS });
      }
  }
