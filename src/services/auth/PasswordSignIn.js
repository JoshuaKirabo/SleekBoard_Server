// Decides how one email + password sign-in ends: the user it signs in as, or turned away. After Flask-Login's README
// login view (look the user up by email, check the password, then login_user), with a hash check instead of its
// plain-text compare and the same gate as Google in front, so only the owner gets in.
//
// Every way of failing gives the same answer (reason "wrong"), so the login screen can't be used to find out which
// emails have accounts or passwords.
const TURNED_AWAY = { reason: "wrong" };

// What the login screen shows for every one of them.
export const WRONG_LOGIN = "That email and password don't match an account.";

export class PasswordSignIn
  {
    constructor({ gate, passwords, hasher })
      {
        this.gate = gate;
        this.passwords = passwords;
        this.hasher = hasher;
      }

    async attempt(login)
      {
        if(!login.email() || !login.password()) return TURNED_AWAY;
        if(!this.gate.allows(login.email())) return TURNED_AWAY;
        const holder = await this.passwords.holder(login.email());
        if(!(await this.isRight(login.password(), holder))) return TURNED_AWAY;
        return { user: this.publicOf(holder) };
      }

    // An account with no password (Google only) can't be signed in to with one.
    async isRight(password, holder)
      {
        if(!holder?.passwordHash) return false;
        return this.hasher.matches(password, holder.passwordHash);
      }

    // The same fields the session hands out (LoginBook.find), never the hash.
    publicOf(holder)
      {
        return { id: holder.id, email: holder.email, name: holder.name };
      }
  }
