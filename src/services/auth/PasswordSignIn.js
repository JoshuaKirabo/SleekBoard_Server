// Decides how one email + password sign-in ends: the user it signs in as, or turned away. After Flask-Login's README
// login view (look the user up by email, check the password, then login_user), with a hash check instead of its
// plain-text compare and the same gate as Google.
//
// Every way of failing gives the same answer (reason "wrong"), and takes as long: after better-auth's email sign-in,
// every attempt that gets this far looks the email up and runs argon2 once, against the real hash or a decoy (see
// DecoyHash). So neither the answer nor its timing tells anyone which emails have an account or a password.
const TURNED_AWAY = { reason: "wrong" };

// What the login screen shows for every one of them.
export const WRONG_LOGIN = "Please check your email and password. They don't match an account.";

export class PasswordSignIn
  {
    constructor({ gate, passwords, hasher, decoy })
      {
        this.gate = gate;
        this.passwords = passwords;
        this.hasher = hasher;
        this.decoy = decoy;
      }

    async attempt(login)
      {
        if(!login.email() || !login.password()) return TURNED_AWAY;
        const holder = await this.passwords.holder(login.email());
        const hash = this.hashToCheck(login.email(), holder);
        if(!(await this.isRight(login.password(), hash))) return TURNED_AWAY;
        return { user: this.publicOf(holder) };
      }

    // The stored hash to check against, or null when this sign-in is turned away whatever the password: no email,
    // nobody by that email, or no argon2 password on the account (Google only).
    hashToCheck(email, holder)
      {
        if(!this.gate.allows(email)) return null;
        if(!this.hasher.isArgon2(holder?.passwordHash)) return null;
        return holder.passwordHash;
      }

    // Runs argon2 once whatever happens: against the real hash, or the decoy when there's none. A decoy match is
    // still no match.
    async isRight(password, hash)
      {
        const matches = await this.hasher.matches(password, hash ?? await this.decoy.stored());
        return Boolean(hash) && matches;
      }

    // The same fields the session hands out (LoginBook.find), never the hash.
    publicOf(holder)
      {
        return { id: holder.id, email: holder.email, name: holder.name };
      }
  }
