// Sign-in's settings from .env, and the checks that stop the server from starting with unsafe ones.
//
//   SESSION_SECRET              signs the session cookie. Required, 32+ characters.
//   GMAIL_CLIENT_ID / _SECRET   the Google OAuth client, shared with Gmail sync for now.
//   GOOGLE_SIGNIN_REDIRECT_URI  where Google sends you back. Defaults to this Mac's /api/auth/google/callback, and
//                               has to match a redirect URI on the client in Google Cloud.
//   CLIENT_URL                  the board. You land on its first origin after signing in.
//   TRUST_PROXY_HOPS            how many proxies sit in front of the server (see trustProxyHops below).
//
// Cloud Run sets K_SERVICE on its own, which is how this knows it's sitting behind Google's proxy.
const MIN_SECRET = 32;
// More than five forwarding steps is no setup we'd run, so a bigger number is a typo.
const MAX_HOPS = 5;
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

    // How many proxies Express trusts to tell it the visitor's address (app.js). Unset: 1 on Cloud Run (Google's front
    // end), 0 anywhere else. A number, never the string: Express reads a string as a list of trusted IP addresses.
    trustProxyHops()
      {
        const raw = (this.env.TRUST_PROXY_HOPS || "").trim();
        if(!raw) return this.isBehindProxy() ? 1 : 0;
        if(!/^\d+$/.test(raw) || Number(raw) > MAX_HOPS) throw new Error(`TRUST_PROXY_HOPS has to be a whole number from 0 to ${MAX_HOPS}. It's "${raw}".`);
        return Number(raw);
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

    // The most any sign-in lasts, used or not (SessionLifetime): 30 days from signing in, ticked, unticked or Google.
    // Ticked and Google cookies already end then in the browser; this makes the server end them then too.
    signedInMaxMs()
      {
        return 30 * DAY_MS;
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
        // app.js reads the hop count as it loads, so a bad one stops the start there first. 0 on Cloud Run would make
        // every visitor Google's front end: one shared address for the sign-in limits, and no https, so no cookie.
        if(this.isBehindProxy() && this.trustProxyHops() === 0) throw new Error("TRUST_PROXY_HOPS can't be 0 on Cloud Run: Google's front end is always one hop.");
      }
  }
