import passport from "passport";
import pg from "pg";
import { prisma } from "../../config/prisma.js";
import { DatabaseUrl } from "../../config/DatabaseUrl.js";
import { sessions } from "../../config/session.js";
import { AuthSettings } from "./AuthSettings.js";
import { SignInGate } from "./SignInGate.js";
import { LoginBook } from "./LoginBook.js";
import { SignIn } from "./SignIn.js";
import { PassportSetup } from "./PassportSetup.js";
import { PasswordBook } from "./PasswordBook.js";
import { PasswordHash } from "./PasswordHash.js";
import { PasswordSignIn } from "./PasswordSignIn.js";

// Sign-in, wired once for the whole server. Only the owner (OWNER_EMAIL) gets in for now, and their first Google
// sign-in links to the account db:copy made for them. Email + password goes through the same gate, and only works
// for an account that already has a password; there's no sign-up.
export const authSettings = new AuthSettings({ env: process.env });

const gate = new SignInGate({ emails: [process.env.OWNER_EMAIL] });
const logins = new LoginBook({ db: prisma, linkableEmail: process.env.OWNER_EMAIL });
const signIn = new SignIn({ gate, logins });
const passwords = new PasswordSignIn({ gate, passwords: new PasswordBook({ db: prisma }), hasher: new PasswordHash() });
new PassportSetup({ passport, settings: authSettings, signIn, logins, passwords }).install();

// The session store gets its own small pool, as sleekboard_app, held to the same rule as Prisma's: a database off
// this Mac only over an encrypted connection.
const pool = new pg.Pool({ connectionString: new DatabaseUrl(process.env.DATABASE_URL).requireSafe().toString(), max: 3 });
// An idle connection dropping (Postgres restarting, say) shouldn't take the server down. The next request reconnects.
pool.on("error", (error) => console.error("Session store connection dropped:", error.message));

export const sessionMiddleware = sessions({ settings: authSettings, pool });
export { passport };
