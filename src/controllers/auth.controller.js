import { StatusCodes } from "http-status-codes";
import { SESSION_COOKIE, sessionCookie } from "../config/session.js";

// Sign-in's routes, after passport/todos-express-google's routes/auth.js. Start and callback are plain links the
// login screen opens, so they send you on (to Google, then to the board or back to /login?signin=error&reason=…)
// instead of answering with JSON. You always land on the board's fixed address, never one taken from the link.
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
