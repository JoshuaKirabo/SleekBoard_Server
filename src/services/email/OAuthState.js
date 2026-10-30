import crypto from "node:crypto";

// The state that goes to Google and comes back, ported from JobNavigator's email_monitor/gmail_auth.py (new_state,
// read_state and check_browser). It stops two things: a made-up callback (it's signed), and someone else's login
// landing on your account (the browser that started has to finish).
//
// - Signed payload { k: "gmail", m: mailbox, n: nonce, e: expiry }, good for 10 minutes.
// - The nonce works once and lives in memory, so a server restart during the Google screen means pressing Connect again.
// - Connect also puts the nonce in a cookie on the browser that pressed it. The callback refuses a state whose nonce
//   that browser doesn't hold.
//
// JobNavigator is MIT licensed: Copyright (c) 2026 JobNavigator Contributors.
// https://github.com/vesaias/JobNavigator/blob/main/backend/email_monitor/gmail_auth.py

export const STATE_MS = 10 * 60_000;

export class StateError extends Error
  {
    constructor(reason)
      {
        super(reason);
        this.reason = reason;
      }
  }

export class OAuthState
  {
    constructor({ keys, now = () => Date.now() })
      {
        this.keys = keys;
        this.now = now;
        this.pending = new Map();
      }

    // A fresh signed state for one mailbox, and its nonce for the browser's cookie.
    make(mailbox)
      {
        this.forgetOld();
        const nonce = crypto.randomBytes(16).toString("base64url");
        const expiry = this.now() + STATE_MS;
        this.pending.set(nonce, expiry);
        const body = Buffer.from(JSON.stringify({ k: "gmail", m: mailbox, n: nonce, e: expiry })).toString("base64url");
        return { state: `${body}.${this.keys.sign(body)}`, nonce };
      }

    // Nonces past their 10 minutes, dropped so the map can't grow forever.
    forgetOld()
      {
        const now = this.now();
        for(const [nonce, expiry] of this.pending) if(expiry < now) this.pending.delete(nonce);
      }

    // The payload of a good state, used up as it's read. Otherwise a StateError: invalid_state, state_expired or
    // state_unknown.
    read(state)
      {
        const payload = this.payloadOf(state);
        if(payload.e < this.now())
          {
            this.pending.delete(payload.n);
            throw new StateError("state_expired");
          }
        if(!this.pending.delete(payload.n)) throw new StateError("state_unknown");
        return payload;
      }

    // The signed payload, checked for shape and signature.
    payloadOf(state)
      {
        if(typeof state !== "string" || state.split(".").length !== 2) throw new StateError("invalid_state");
        const [body, signature] = state.split(".");
        if(!this.keys.same(signature, this.keys.sign(body))) throw new StateError("invalid_state");
        let payload;
        try
          {
            payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
          }
        catch
          {
            throw new StateError("invalid_state");
          }
        const good = payload && payload.k === "gmail" && typeof payload.e === "number" && payload.m && payload.n;
        if(!good) throw new StateError("invalid_state");
        return payload;
      }

    // browser_mismatch unless the browser coming back holds this state's nonce.
    checkBrowser(payload, cookieNonce)
      {
        if(!cookieNonce || !this.keys.same(cookieNonce, payload.n)) throw new StateError("browser_mismatch");
      }
  }
