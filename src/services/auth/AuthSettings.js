// Sign-in's settings from .env, and the checks that stop the server from starting with unsafe ones.
//
//   SESSION_SECRET              signs the session cookie. Required, 32+ characters.
//   GMAIL_CLIENT_ID / _SECRET   the Google OAuth client, shared with Gmail sync for now.
//   GOOGLE_SIGNIN_REDIRECT_URI  where Google sends you back. Defaults to this Mac's /api/auth/google/callback, and
//                               has to match a redirect URI on the client in Google Cloud.
//   CLIENT_URL                  the board. You land on its first origin after signing in.
//
// Cloud Run sets K_SERVICE on its own, which is how this knows it's sitting behind Google's proxy.
const MIN_SECRET = 32;
const DAY_MS = 24 * 60 * 60_000;

export class AuthSettings
  {
    constructor({ env })
      {
        this.env = env;
      }

    secret()
      {
        return this.env.SESSION_SECRET || "";
      }

    clientId()
      {
        return this.env.GMAIL_CLIENT_ID || "";
      }

    clientSecret()
      {
        return this.env.GMAIL_CLIENT_SECRET || "";
      }

    // Whether there's a Google client to sign in with at all.
    isConfigured()
      {
        return Boolean(this.clientId() && this.clientSecret());
      }

    // A full URL from .env, never one built from the request's Host header.
    callbackUrl()
      {
        return this.env.GOOGLE_SIGNIN_REDIRECT_URI || `http://localhost:${this.env.PORT || 5050}/api/auth/google/callback`;
      }

    // Secure cookies when Google sends people back over https. Read from the setting, not the request, so it can't
    // quietly drop to http behind a proxy.
    isSecure()
      {
        return this.callbackUrl().startsWith("https://");
      }

    isBehindProxy()
      {
        return Boolean(this.env.K_SERVICE);
      }

    // Every new session's cookie, Google sign-in's included: 30 days. The email + password form sets its own below.
    sessionMs()
      {
        return 30 * DAY_MS;
      }

    // "Keep me logged in" ticked on the email + password form: 30 days, Mailtrain's figure.
    rememberMs()
      {
        return 30 * DAY_MS;
      }

    // Unticked, the cookie has no date and ends when the browser closes, which the server never hears about. Its row in
    // Postgres goes a day after its last request instead, so it's swept soon after the browser closes but never under
    // someone still using the board (each request pushes it on).
    browserSessionIdleSeconds()
      {
        return DAY_MS / 1000;
      }

    // The board's own address, from the first of CLIENT_URL's origins.
    clientUrl()
      {
        return (this.env.CLIENT_URL || "http://localhost:5173").split(",")[0].trim().replace(/\/$/, "");
      }

    successUrl()
      {
        return `${this.clientUrl()}/`;
      }

    failureUrl(reason)
      {
        return `${this.clientUrl()}/login?${new URLSearchParams({ signin: "error", reason })}`;
      }

    // Throws one plain sentence for the first unsafe setting. The secret's value is never in it.
    check()
      {
        if(!this.secret()) throw new Error("SESSION_SECRET is missing from .env. Make one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\"");
        if(this.secret().length < MIN_SECRET) throw new Error(`SESSION_SECRET is too short. It needs ${MIN_SECRET}+ characters.`);
        // Without CLIENT_URL a deploy would send you to this Mac's localhost after signing in, so it must name the board.
        if(this.isBehindProxy() && !this.env.CLIENT_URL) throw new Error("CLIENT_URL has to be set on Cloud Run: it's the board sign-in sends you back to.");
      }
  }
