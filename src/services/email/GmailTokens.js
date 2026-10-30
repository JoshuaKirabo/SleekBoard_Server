// The saved Gmail login and the access tokens made from it, ported from JobNavigator's email_monitor/gmail_auth.py
// (resolve_token, is_expired, mark_expired, status) and gmail_client.py (_get_access_token).
//
// One change from theirs: an access token lasts an hour, so it's kept until a minute before it runs out instead of
// asking Google for a new one every check. Theirs checks every 30 minutes; ours checks every minute.
//
// keys is null when GMAIL_SECRET is missing or too short. Then nothing's connected and nothing calls Google.
//
// JobNavigator is MIT licensed: Copyright (c) 2026 JobNavigator Contributors.
// https://github.com/vesaias/JobNavigator/blob/main/backend/email_monitor/gmail_auth.py

// Used up this long before Google says it runs out, so a check never starts with a token about to die.
const MARGIN_MS = 60_000;

export class GmailTokens
  {
    constructor({ mailbox, auth, keys, now = () => Date.now() })
      {
        this.mailbox = mailbox;
        this.auth = auth;
        this.keys = keys;
        this.now = now;
        this.cached = null;
      }

    // True once the .env settings are all there.
    configured()
      {
        return Boolean(this.keys) && this.auth.configured();
      }

    // { status: "connected" | "none" | "expired", configured, address } for the board.
    async status()
      {
        const box = await this.mailbox.get();
        const login = this.loginOf(box);
        return { status: this.stateOf(box, login), configured: this.configured(), address: login ? box.address : "" };
      }

    stateOf(box, login)
      {
        if(!login) return "none";
        return this.isExpired(box, login) ? "expired" : "connected";
      }

    // The saved login unlocked, or "" when there's none, the keys are missing, or it won't unlock.
    loginOf(box)
      {
        if(!this.configured() || !box.login) return "";
        return this.keys.unlock(box.login);
      }

    isExpired(box, login)
      {
        return Boolean(box.expired) && box.expired === this.keys.fingerprint(login);
      }

    // True when a check could run: a login that Google hasn't refused.
    async connected()
      {
        return (await this.status()).status === "connected";
      }

    // An access token for Gmail, or "" when there's no working login. A login Google refuses for good is marked
    // expired, and nothing calls Google with it again until you reconnect.
    async access()
      {
        const box = await this.mailbox.get();
        const login = this.loginOf(box);
        if(!login || this.isExpired(box, login)) return "";
        if(this.cached?.login === login && this.cached.until > this.now()) return this.cached.token;
        return this.renew(login);
      }

    async renew(login)
      {
        try
          {
            const { token, expiresIn } = await this.auth.refresh(login);
            this.cached = { login, token, until: this.now() + expiresIn * 1000 - MARGIN_MS };
            return token;
          }
        catch(error)
          {
            if(error.invalidGrant) await this.mailbox.markExpired(this.keys.fingerprint(login));
            else console.warn("Gmail's access token didn't renew:", error.message);
            return "";
          }
      }

    // Gmail turned the access token down (a 401). Forget it, so the next one comes fresh from Google, and if the login
    // itself is dead, Google says so then and it's marked expired. Without this a dead login looks connected for up to
    // the hour the old token had left.
    drop()
      {
        this.cached = null;
      }

    // Saves a new login, locked, for this Gmail address.
    async save(login, address)
      {
        this.cached = null;
        return this.mailbox.connect(this.keys.lock(login), address);
      }

    async forget()
      {
        this.cached = null;
        return this.mailbox.disconnect();
      }
  }
