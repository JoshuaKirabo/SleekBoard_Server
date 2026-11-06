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
import { DecoyHash } from "./DecoyHash.js";
import { LoginLimits } from "./LoginLimits.js";
import { SessionLifetime } from "./SessionLifetime.js";

// Sign-in, wired once for the whole server. Anyone gets in with an email Google has checked, or an email + password on
// an account that has one. A first Google sign-in links to the account already under its email (LoginBook).
export const authSettings = new AuthSettings({ env: process.env });

const gate = new SignInGate();
const logins = new LoginBook({ db: prisma });
const signIn = new SignIn({ gate, logins });
const hasher = new PasswordHash();
const decoy = new DecoyHash({ hasher });
// Made now rather than on the first turned-away sign-in, which would otherwise take twice as long as the rest.
decoy.stored().catch((error) => console.error("Making the decoy password hash failed:", error.message));
const passwords = new PasswordSignIn({ gate, passwords: new PasswordBook({ db: prisma }), hasher, decoy });
new PassportSetup({ passport, settings: authSettings, signIn, logins, passwords }).install();

// The session store and the sign-in limits share their own small pool, as sleekboard_app, held to the same rule as
// Prisma's: a database off this Mac only over an encrypted connection.
const pool = new pg.Pool({ connectionString: new DatabaseUrl(process.env.DATABASE_URL).requireSafe().toString(), max: 3 });
// An idle connection dropping (Postgres restarting, say) shouldn't take the server down. The next request reconnects.
pool.on("error", (error) => console.error("Session store connection dropped:", error.message));

// Failed email + password tries, counted in Postgres (login_limits) so a restart or a second server doesn't reset them.
export const loginLimits = LoginLimits.inPostgres({ pool });

// The 30 days from sign-in that no session outlives, however much it's used.
export const sessionLifetime = new SessionLifetime({ settings: authSettings });

export const sessionMiddleware = sessions({ settings: authSettings, pool, lifetime: sessionLifetime });
export { passport };
