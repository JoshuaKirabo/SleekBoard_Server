// Who's allowed to sign in. For now that's only the owner (OWNER_EMAIL), so anyone else is turned away before an
// account is made for them. Opening it up waits until every store takes the signed-in person instead of the owner
// (piece 3), or a stranger could end up working on the owner's data.
export class SignInGate
  {
    constructor({ emails })
      {
        this.emails = emails.map((email) => String(email || "").trim().toLowerCase()).filter(Boolean);
      }

    // Google has to have checked the email, and it has to be on the list.
    admits(account)
      {
        return account.isVerified() && this.emails.includes(account.email());
      }
  }
