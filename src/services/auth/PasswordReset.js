// Sets a new password on an account that's already there, from the terminal (npm run set-password). After Immich's
// reset-admin-password command and the CliService.resetAdminPassword it calls: find the account, hand it to `ask`
// (which shows it and asks the questions), hash the answer, save it, and if asked, end every session that user has.
//
// It never makes an account. There's no sign-up, so an email nobody has stops here.
export class Refusal extends Error
  {
  }

export class PasswordReset
  {
    constructor({ accounts, hasher, sessions })
      {
        this.accounts = accounts;
        this.hasher = hasher;
        this.sessions = sessions;
      }

    // `ask(account)` answers { password, signOut }. Nothing is written until both questions are answered.
    async run(email, ask)
      {
        const account = await this.found(email);
        const { password, signOut } = await ask(account);
        if(!password) throw new Refusal("An empty password can't be set.");
        await this.accounts.keepHash(account.id, await this.hasher.make(password));
        const ended = signOut ? await this.sessions.endAll(account.id) : 0;
        return { account, signedOut: Boolean(signOut), ended };
      }

    async found(email)
      {
        const account = email ? await this.accounts.find(email) : null;
        if(!account) throw new Refusal(`There's no account with the email ${email || "(none given)"}. This only sets the password of an account that's already there.`);
        return account;
      }
  }
