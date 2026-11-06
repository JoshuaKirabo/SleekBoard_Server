// The longest a signed-in session lives, however much it's used: OWASP's "absolute timeout", next to the idle one the
// cookie and its row already have. Without it, express-session pushes the row on with every request, so a copied
// cookie used once a month would never end.
//
// After expressjs/session PR #595 ("implement max duration of session", for issue #557): the session keeps the time
// it started, and when a request's session is loaded past that time plus the limit, it gets a new, empty session
// instead. Ours stamps at sign-in rather than when the session is made, and the check sits in the store's get
// (CappedPgStore), which also deletes the old row so the cookie can't be used again.
//
// The stamp is the sign-in time in ms, in the session's json in Postgres. No answer ever sends the session to the
// browser, so it stays on the server.
export class SessionLifetime
  {
    constructor({ settings })
      {
        this.settings = settings;
      }

    // Called right after req.logIn, which has just swapped in a fresh session, so the stamp is this sign-in's own.
    stamp(session)
      {
        session.signedInAt = Date.now();
      }

    // When this sign-in has to end, in ms, or null when the session has no usable stamp.
    endOf(sess)
      {
        if(!Number.isFinite(sess?.signedInAt)) return null;
        return sess.signedInAt + this.settings.signedInMaxMs();
      }

    // passport keeps the user's id at sess.passport.user. A session nobody signed in to (Google's state, say) has none.
    isSignedIn(sess)
      {
        return Boolean(sess?.passport?.user);
      }

    // A signed-in session with no stamp counts as run out, as in PR #595: it's from before this check, or its stamp
    // was never saved. Either way, signing in again gives it one.
    hasRunOut(sess)
      {
        if(!this.isSignedIn(sess)) return false;
        const end = this.endOf(sess);
        return end === null || end <= Date.now();
      }
  }
