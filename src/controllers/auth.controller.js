import { StatusCodes } from "http-status-codes";
import { SESSION_COOKIE, sessionCookie } from "../config/session.js";
import { PasswordLogin } from "../services/auth/PasswordLogin.js";
import { WRONG_LOGIN } from "../services/auth/PasswordSignIn.js";
import { SessionLifetime } from "../services/auth/SessionLifetime.js";

// One answer for every failed email + password sign-in, so it never says which part was wrong.
export { WRONG_LOGIN };

// When the failed-try counts can't be read or written. Sign-in stays shut rather than letting guesses through uncounted.
export const LIMITS_DOWN = "Sign-in isn't available right now. Try again in a minute.";

// Sign-in's routes, after passport/todos-express-google's routes/auth.js. Start and callback are plain links the
// login screen opens, so they send you on (to Google, then to the board or back to /login?signin=error&reason=…)
// instead of answering with JSON. You always land on the board's fixed address, never one taken from the link.
// Email + password is a fetch from the login form, so it answers with JSON instead.
//
// `limits` counts failed email + password tries (LoginLimits, in Postgres). Without them email + password sign-in
// answers 503 (limitsDown) rather than going unlimited. `lifetime` stamps each sign-in (SessionLifetime), so the
// session ends 30 days later however much it's used.
export class AuthController
  {
    constructor({ passport, settings, limits, lifetime = new SessionLifetime({ settings }) })
      {
        this.passport = passport;
        this.settings = settings;
        this.limits = limits;
        this.lifetime = lifetime;
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

    // Signs the user in (a fresh session, so nothing from before carries over), stamps when, and sends them to the
    // board.
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
            this.lifetime.stamp(req.session);
            this.landSaved(req, res, next);
          });
      }

    // Saves the stamp before sending you on, so the board's first request already finds it.
    landSaved(req, res, next)
      {
        req.session.save((error) =>
          {
            if(error) return next(error);
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

    // POST /api/auth/login with { email, password, remember }. The try is counted first (LoginLimits.countTry), so
    // someone over a limit doesn't get a password checked, the right one included. Then passport-local's strategy
    // (PassportSetup) checks the email and password. todos-express-password lets passport redirect; this answers JSON
    // itself, so it takes over.
    async logIn(req, res, next)
      {
        const login = new PasswordLogin(req.body);
        try
          {
            const wait = await this.limits.countTry(login, req.ip);
            if(wait > 0) return this.tooMany(res, wait);
          }
        catch(error)
          {
            return this.limitsDown(res, error);
          }
        this.passport.authenticate("local", (error, user) => this.admit(req, res, next, { error, user, login }))(req, res, next);
      }

    // Flask-Login's login_user: req.logIn starts a fresh session for the user (passport 0.7 swaps the session id, so
    // nothing from before carries over), and the stamp goes into that fresh one. Every failure, passport-local's own
    // "Missing credentials" too, gets the one message and keeps the count it was given. A right password hands its
    // count back first.
    async admit(req, res, next, { error, user, login })
      {
        if(error) return next(error);
        if(!user) return res.status(StatusCodes.UNAUTHORIZED).json({ message: WRONG_LOGIN });
        try
          {
            await this.limits.succeeded(login, req.ip);
          }
        catch(limitsError)
          {
            return this.limitsDown(res, limitsError);
          }
        req.logIn(user, (loginError) =>
          {
            if(loginError) return next(loginError);
            this.lifetime.stamp(req.session);
            this.keepFor(req, login.remember());
            this.answerSaved(req, res, next, { user });
          });
      }

    // 429 with Retry-After in seconds, as the wiki answers, and a sentence the login form can show as it is.
    tooMany(res, seconds)
      {
        res.set("Retry-After", String(seconds));
        res.status(StatusCodes.TOO_MANY_REQUESTS).json({ message: `Too many sign-in attempts. Try again in ${this.waitWords(seconds)}.` });
      }

    // "a minute", "12 minutes", "1 hour", "24 hours". Rounded up, so it never promises sooner than Retry-After.
    waitWords(seconds)
      {
        const minutes = Math.ceil(seconds / 60);
        if(minutes <= 1) return "a minute";
        if(minutes < 60) return `${minutes} minutes`;
        const hours = Math.ceil(minutes / 60);
        return hours === 1 ? "1 hour" : `${hours} hours`;
      }

    // The counts live in Postgres with the users and sessions, so when they can't be read or written, sign-in couldn't
    // work anyway. Shut, said out loud in the log and in the answer, rather than letting tries through uncounted.
    limitsDown(res, error)
      {
        console.error("Sign-in limits couldn't be checked, so email + password sign-in is shut:", error.message);
        res.status(StatusCodes.SERVICE_UNAVAILABLE).json({ message: LIMITS_DOWN });
      }

    // Mailtrain's restLogin: the sign-in itself says how long the cookie lasts. Ticked, 30 days from now (the browser
    // keeps that date; the row is pushed on by each request). Unticked, no date at all, so the browser drops it when it
    // closes. Mailtrain writes `expires = false`; null is express-session's own "no date" and sends the same cookie.
    keepFor(req, remember)
      {
        req.session.cookie.maxAge = remember ? this.settings.rememberMs() : null;
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
