// Who's allowed to sign in: anyone with an email. Google also has to have checked that email (Twenty's Google strategy
// and better-auth's account linking both refuse an email Google hasn't checked), since LoginBook goes by the email to
// find an account that was made with a password.
export class SignInGate
  {
    // Google has to have checked the email.
    admits(account)
      {
        return account.isVerified() && this.allows(account.email());
      }

    // Whether there's an email to sign in with. Email + password sign-in asks this directly: the email is the one on the
    // account, so there's nobody else to vouch for it.
    allows(email)
      {
        return Boolean(email);
      }
  }
