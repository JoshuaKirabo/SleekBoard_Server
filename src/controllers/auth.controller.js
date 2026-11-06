import { StatusCodes } from "http-status-codes";
import { SESSION_COOKIE, sessionCookie } from "../config/session.js";
import { PasswordLogin } from "../services/auth/PasswordLogin.js";
import { WRONG_LOGIN } from "../services/auth/PasswordSignIn.js";

// One answer for every failed email + password sign-in, so it never says which part was wrong.
export { WRONG_LOGIN };

// Sign-in's routes, after passport/todos-express-google's routes/auth.js. Start and callback are plain links the
// login screen opens, so they send you on (to Google, then to the board or back to /login?signin=error&reason=…)
// instead of answering with JSON. You always land on the board's fixed address, never one taken from the link.
// Email + password is a fetch from the login form, so it answers with JSON instead.
export class AuthController
  {
    constructor({ passport, settings })
      {
        this.passport = passport;
        this.settings = settings;
      }

    // GET /api/auth/google. Off to Google's account picker.
    startGoogle(req, res, next)
      {
        if(!this.settings.isConfigured()) return res.status(StatusCodes.SERVICE_UNAVAILABLE).json({ message: "Google sign-in isn't set up. Add GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET to .env." });
        this.passport.authenticate("google")(req, res, next);
      }

    // GET /api/auth/google/callback. Where Google sends you back.
    finishGoogle(req, res, next)
      {
        if(!this.settings.isConfigured()) return res.redirect(this.settings.failureUrl("not_set_up"));
        this.passport.authenticate("google", (error, user, info) => this.land(req, res, next, { error, user, info }))(req, res, next);
      }

    // Signs the user in (a fresh session, so nothing from before carries over) and sends them to the board.
    land(req, res, next, { error, user, info })
      {
        if(error)
          {
            // Google's token errors carry a code (invalid_grant) and sometimes no message.
            console.error("Google sign-in failed:", error.message || error.code || error.name);
            return res.redirect(this.settings.failureUrl("google"));
          }
        if(!user) return res.redirect(this.settings.failureUrl(this.reasonOf(info)));
        req.logIn(user, (loginError) =>
          {
            if(loginError) return next(loginError);
            res.redirect(this.settings.successUrl());
          });
      }

    // Our own reasons first. Otherwise passport-oauth2 only says why in words: a state it can't match means the sign-in
    // took too long or started in another browser; anything else is you pressing Cancel on Google.
    reasonOf(info)
      {
        if(info?.reason) return info.reason;
        if(/state/i.test(info?.message || "")) return "expired";
        return "cancelled";
      }

    // POST /api/auth/login with { email, password, remember }. passport-local's strategy (PassportSetup) checks the
    // email and password. todos-express-password lets passport redirect; this answers JSON itself, so it takes over.
    logIn(req, res, next)
      {
        this.passport.authenticate("local", (error, user) => this.admit(req, res, next, { error, user }))(req, res, next);
      }

    // Flask-Login's login_user: req.logIn starts a fresh session for the user (passport 0.7 swaps the session id, so
    // nothing from before carries over). Every failure, passport-local's own "Missing credentials" too, gets the one
    // message.
    admit(req, res, next, { error, user })
      {
        if(error) return next(error);
        if(!user) return res.status(StatusCodes.UNAUTHORIZED).json({ message: WRONG_LOGIN });
        req.logIn(user, (loginError) =>
          {
            if(loginError) return next(loginError);
            this.keepFor(req, new PasswordLogin(req.body).remember());
            this.answerSaved(req, res, next, { user });
          });
      }

    // Remember ticked keeps the session's usual 30 days. Unticked, the cookie loses its expiry date, so the browser
    // drops it when it closes.
    keepFor(req, remember)
      {
        if(!remember) req.session.cookie.maxAge = null;
      }

    // Saves the session before answering, so the row in Postgres has the same lifetime as the cookie the browser gets.
    answerSaved(req, res, next, body)
      {
        req.session.save((error) =>
          {
            if(error) return next(error);
            res.json(body);
          });
      }

    // POST /api/auth/logout. passport ends the signed-in session (its row goes), then hands over a fresh empty one,
    // which express-session would save and send a new cookie for. Nobody needs it, so it goes too.
    signOut(req, res, next)
      {
        req.logout((error) =>
          {
            if(error) return next(error);
            this.dropSession(req, res, next);
          });
      }

    // Deletes the session and its cookie, leaving nothing behind.
    dropSession(req, res, next)
      {
        req.session.destroy((error) =>
          {
            if(error) return next(error);
            res.clearCookie(SESSION_COOKIE, sessionCookie(this.settings));
            res.status(StatusCodes.NO_CONTENT).end();
          });
      }

    // GET /api/auth/me. Who's signed in, or 401.
    me(req, res)
      {
        if(!req.user) return res.status(StatusCodes.UNAUTHORIZED).json({ message: "Not signed in." });
        res.json({ user: req.user });
      }
  }
