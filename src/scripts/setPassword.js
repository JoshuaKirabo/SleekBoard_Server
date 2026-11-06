import "dotenv/config";
import { prisma } from "../config/prisma.js";
import { DatabaseUrl } from "../config/DatabaseUrl.js";
import { PasswordLogin } from "../services/auth/PasswordLogin.js";
import { PasswordHash } from "../services/auth/PasswordHash.js";
import { PasswordAccounts } from "../services/auth/PasswordAccounts.js";
import { UserSessions } from "../services/auth/UserSessions.js";
import { PasswordReset, Refusal } from "../services/auth/PasswordReset.js";
import { Terminal } from "./setPassword/Terminal.js";
import { ResetQuestions } from "./setPassword/ResetQuestions.js";

// Sets the email + password sign-in password of an account that's already there. There's no sign-up and no
// forgot-password email, so this is how a password gets set or changed. After Immich's reset-admin-password command.
//
//   npm run set-password -- you@example.com
//
// It shows the account it found, asks for the new password twice (not shown as you type), then asks whether to sign
// that person out everywhere. Nothing changes until every question is answered.
//
// It connects as DATABASE_URL's user, sleekboard_app, the same as the server: saving a hash and deleting session rows
// is row work, which is all that user may do (prisma/roles.sql). The owner user isn't needed.

// The same lowercase, trimmed email sign-in looks up.
const email = new PasswordLogin({ email: process.argv[2] }).email();
if(!email.includes("@"))
  {
    console.error("Say whose password to set: npm run set-password -- you@example.com");
    process.exit(1);
  }

// Named first, so it's plain which database is about to change.
console.log(`Database: ${new DatabaseUrl(process.env.DATABASE_URL).label()}`);

const terminal = new Terminal({ input: process.stdin, output: process.stdout });
const questions = new ResetQuestions({ terminal });
const reset = new PasswordReset({ accounts: new PasswordAccounts({ db: prisma }), hasher: new PasswordHash(), sessions: new UserSessions({ db: prisma }) });

try
  {
    const { account, signedOut, ended } = await reset.run(email, (found) => questions.ask(found));
    console.log(`The password for ${account.email} has been set.`);
    console.log(signedOut ? `Signed out everywhere: ${ended} session(s) ended.` : "Sessions left as they were.");
  }
catch(error)
  {
    if(error instanceof Refusal) console.error(`${error.message} Nothing was changed.`);
    else console.error(`Setting the password failed: ${error.message}`);
    process.exitCode = 1;
  }
finally
  {
    terminal.close();
    await prisma.$disconnect();
  }
