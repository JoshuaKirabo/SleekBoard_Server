// Decides how one Google sign-in ends: the user it signs in as, or why it was turned away. The gate says who's
// allowed at all; the login book finds, links or makes their account.
//
// Reasons go back to the login screen as ?reason=…:
//   not_allowed   not on the list (or Google hasn't checked the email)
//   not_linkable  the email belongs to an account that already has another login
export class SignIn
  {
    constructor({ gate, logins })
      {
        this.gate = gate;
        this.logins = logins;
      }

    async attempt(account)
      {
        if(!this.gate.admits(account)) return { reason: "not_allowed" };
        const user = await this.logins.userFor(account);
        if(!user) return { reason: "not_linkable" };
        return { user };
      }
  }
