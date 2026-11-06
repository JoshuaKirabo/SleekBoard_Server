// The account set-password works on, looked up by email, and where its new hash gets saved. The hash itself never
// comes out of here, only whether there is one, so the terminal can say "set" or "none".
const SHOWN = { id: true, email: true, name: true, passwordHash: true, logins: { select: { subject: true } } };

export class PasswordAccounts
  {
    constructor({ db })
      {
        this.db = db;
      }

    // { id, email, name, hasPassword, googleIds } for this (already lowercase) email, or null when there's nobody.
    async find(email)
      {
        const user = await this.db.user.findUnique({ where: { email }, select: SHOWN });
        if(!user) return null;
        return { id: user.id, email: user.email, name: user.name, hasPassword: Boolean(user.passwordHash), googleIds: user.logins.map((login) => login.subject) };
      }

    // update, not upsert, so a user that's gone by now makes it throw instead of quietly making a new one.
    async keepHash(userId, passwordHash)
      {
        await this.db.user.update({ where: { id: userId }, data: { passwordHash } });
      }
  }
