// Finds the account an email + password sign-in is for, along with its stored password hash. The hash only ever goes
// from here to PasswordSignIn; nothing that answers a request gets it.
const WITH_HASH = { id: true, email: true, name: true, passwordHash: true };

export class PasswordBook
  {
    constructor({ db })
      {
        this.db = db;
      }

    // The user with this (already lowercase) email and their hash, or null when there's nobody by that email.
    async holder(email)
      {
        if(!email) return null;
        return this.db.user.findUnique({ where: { email }, select: WITH_HASH });
      }
  }
