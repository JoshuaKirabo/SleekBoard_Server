import session from "express-session";
import connectPgSimple from "connect-pg-simple";

const PgStore = connectPgSimple(session);
// connect-pg-simple's own fallback when no ttl is given.
const ONE_DAY_SECONDS = 86400;

// connect-pg-simple's store, held to SessionLifetime's 30 days from sign-in:
// - get: a signed-in session past them (or with no stamp) is deleted and loaded as no session at all. That's where
//   expressjs/session PR #595 checks too, as the session is read: express-session then starts the request on a new,
//   empty session it won't save or send a cookie for unless something is put in it (a new sign-in), so the request
//   carries on signed out and requireUser answers 401.
// - set and touch: a signed-in row's end (expire) never goes past its sign-in's end. express-session touches the row
//   on every request, which would otherwise push it on forever; this way the 15-minute sweep deletes it on time even
//   if nobody comes back to be turned away.
//
// The library works the end out from the session's cookie in a private method, so set and touch hand it a copy whose
// cookie date is the sign-in's end whenever the usual end would be later. touch only writes the end. set also stores
// that date in the json, which express-session overwrites on the next request (touch sets it again from the cookie's
// length), so the browser's cookie never changes because of it.
export class CappedPgStore extends PgStore
  {
    constructor({ lifetime, ...options })
      {
        super(options);
        this.lifetime = lifetime;
      }

    get(sid, done)
      {
        super.get(sid, (error, sess) => this.checked(sid, { error, sess }, done));
      }

    // The session as read, unless its sign-in has run out.
    checked(sid, { error, sess }, done)
      {
        if(error || !sess || !this.lifetime.hasRunOut(sess)) return done(error, sess);
        this.turnAway(sid, done);
      }

    // Deletes the row and answers "no session", as the library does for a row it can't read.
    turnAway(sid, done)
      {
        this.destroy(sid, (error) => done(error || null));
      }

    set(sid, sess, done)
      {
        super.set(sid, this.capped(sess), done);
      }

    touch(sid, sess, done)
      {
        super.touch(sid, this.capped(sess), done);
      }

    // The session as given, or a copy whose cookie ends at the sign-in's end.
    capped(sess)
      {
        const end = this.lifetime.endOf(sess);
        if(end === null) return sess;
        const latest = this.wholeSecondsUpTo(end);
        if(this.usualEnd(sess) <= latest) return sess;
        return { ...sess, cookie: { ...this.plainCookie(sess.cookie), expires: new Date(latest) } };
      }

    // The library rounds the end up to a whole second, which could land up to a second past the sign-in's end. Rounding
    // down first keeps the row's end at or before it.
    wholeSecondsUpTo(ms)
      {
        return Math.floor(ms / 1000) * 1000;
      }

    // When connect-pg-simple would end the row, in ms: the cookie's date, or `ttl` from now for a cookie with none.
    usualEnd(sess)
      {
        if(sess.cookie?.expires) return new Date(sess.cookie.expires).valueOf();
        return Date.now() + (this.ttl || ONE_DAY_SECONDS) * 1000;
      }

    // express-session's Cookie keeps its date in a getter, which spreading would miss; toJSON is what gets stored.
    plainCookie(cookie)
      {
        return typeof cookie?.toJSON === "function" ? cookie.toJSON() : { ...cookie };
      }
  }
