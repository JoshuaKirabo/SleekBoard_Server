import { StatusCodes } from "http-status-codes";
import { StateError } from "./OAuthState.js";

const failure = (status, message) => Object.assign(new Error(message), { status });

// Connecting Gmail from start to finish, ported from JobNavigator's api/routes_gmail.py (gmail_connect and
// _callback). Start makes a signed state and sends you to Google. Finish checks the state and the browser, swaps
// Google's code for a login, and saves it.
//
// One addition: once connected it asks Gmail which address it is, so the board can say "Connected as you@gmail.com".
//
// JobNavigator is MIT licensed: Copyright (c) 2026 JobNavigator Contributors.
// https://github.com/vesaias/JobNavigator/blob/main/backend/api/routes_gmail.py
export class GmailConnect
  {
    constructor({ auth, states, tokens, gmail, mailbox = "me" })
      {
        this.auth = auth;
        this.states = states;
        this.tokens = tokens;
        this.gmail = gmail;
        this.mailbox = mailbox;
      }

    // Google's consent link and the nonce for this browser's cookie. 503 until .env has everything.
    start()
      {
        if(!this.tokens.configured()) throw failure(StatusCodes.SERVICE_UNAVAILABLE, "Gmail isn't set up yet: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET and GMAIL_SECRET go in the server's .env.");
        const { state, nonce } = this.states.make(this.mailbox);
        return { url: this.auth.consentUrl(state), nonce };
      }

    // What Google sent back. { ok: true, address } or { ok: false, reason }, never a throw, since the answer is a
    // redirect to the board either way.
    async finish({ code, state, error, nonce })
      {
        const refused = this.checkState(state, nonce);
        if(refused) return { ok: false, reason: refused };
        if(error) return { ok: false, reason: String(error).slice(0, 40) };
        if(!code) return { ok: false, reason: "no_code" };
        return this.save(String(code));
      }

    // The state's reason for refusing, or "" when it's good. Reading it uses it up.
    checkState(state, nonce)
      {
        try
          {
            this.states.checkBrowser(this.states.read(state), nonce);
            return "";
          }
        catch(caught)
          {
            if(caught instanceof StateError) return caught.reason;
            throw caught;
          }
      }

    // Swaps the code for a login, finds the address, and saves both.
    async save(code)
      {
        let login;
        try
          {
            login = await this.auth.exchange(code);
          }
        catch(caught)
          {
            console.warn("Gmail connect: Google wouldn't swap the code:", caught.message);
            return { ok: false, reason: "exchange_failed" };
          }
        const address = await this.addressOf(login);
        await this.tokens.save(login, address);
        return { ok: true, address };
      }

    // The Gmail address, or "" if asking failed. Not worth refusing the connection over.
    async addressOf(login)
      {
        try
          {
            const { token } = await this.auth.refresh(login);
            return String((await this.gmail.profile(token)).emailAddress || "");
          }
        catch
          {
            return "";
          }
      }

    disconnect()
      {
        return this.tokens.forget();
      }
  }
