import session from "express-session";
import connectPgSimple from "connect-pg-simple";

// Who's signed in on each browser, kept in Postgres' sessions table (prisma/schema.prisma), so a restart or a deploy
// doesn't sign anyone out and signing out really ends it. After passport/todos-express-google's app.js, with their
// SQLite store swapped for connect-pg-simple and their hard-coded secret for SESSION_SECRET.
//
// The cookie only holds the session's id, signed. Page scripts can't read it (httpOnly). Lax lets it ride along on
// Google's redirect back but not on another site's fetch or form, which is what keeps other sites from acting as you.
// Never None: that would let any site use your session.
export const SESSION_COOKIE = "sb_session";

const PgStore = connectPgSimple(session);

export const sessionCookie = (settings) => ({ httpOnly: true, sameSite: "lax", secure: settings.isSecure(), path: "/" });

// `prune` is how often old sessions get swept out (connect-pg-simple's default is 15 minutes). Tests turn it off.
export const sessions = ({ settings, pool, prune }) =>
  {
    const store = new PgStore({ pool, tableName: "sessions", pruneSessionInterval: prune });
    return session(
      {
        name: SESSION_COOKIE,
        secret: settings.secret(),
        resave: false,
        saveUninitialized: false,
        store,
        cookie: { ...sessionCookie(settings), maxAge: settings.sessionMs() },
      });
  };
