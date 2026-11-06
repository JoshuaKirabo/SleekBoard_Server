import { Refusal } from "../../services/auth/PasswordReset.js";

// What set-password shows and asks before anything changes. After Immich's prompt (prints the admin it found) and its
// PromptPasswordResetQuestions (new password, then "Invalidate existing sessions?" with yes as the default). Unlike
// Immich, the password is typed hidden and twice, and an empty one is turned down instead of swapped for a random one.
const YES = ["", "y", "yes"];
const NO = ["n", "no"];

export class ResetQuestions
  {
    constructor({ terminal })
      {
        this.terminal = terminal;
      }

    // The `ask` PasswordReset.run takes: { password, signOut } for this account.
    async ask(account)
      {
        this.show(account);
        const password = await this.password();
        const signOut = await this.signOut();
        return { password, signOut };
      }

    show(account)
      {
        this.terminal.say(["Found account:", `- ID=${account.id}`, `- Email=${account.email}`, `- Name=${account.name || "(none)"}`, `- Google ID=${account.googleIds.join(", ") || "(none)"}`, `- Password=${account.hasPassword ? "set, will be replaced" : "none yet"}`].join("\n"));
      }

    async password()
      {
        const password = await this.terminal.askHidden("New password: ");
        if(!password) throw new Refusal("An empty password can't be set.");
        const again = await this.terminal.askHidden("Type it again: ");
        if(again !== password) throw new Refusal("The two passwords didn't match.");
        return password;
      }

    // Asks until the answer is a yes or a no. Just pressing Enter is yes, like Immich.
    async signOut()
      {
        while(true)
          {
            const answer = (await this.terminal.ask("Sign out everywhere? (Y/n) ")).trim().toLowerCase();
            if(YES.includes(answer)) return true;
            if(NO.includes(answer)) return false;
            this.terminal.say("Answer y or n.");
          }
      }
  }
