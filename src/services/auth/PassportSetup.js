import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { GoogleAccount } from "./GoogleAccount.js";

// Hands passport the Google strategy and how to keep someone in their session. Same shape as both sign-in videos
// (passport-google-oauth20, profile + email, serialize / deserialize), with three changes:
// - state: true, so a stranger can't finish a sign-in they started in your browser and land you in their account.
//   passport/todos-express-google gets this from passport-google-oidc, which always does it.
// - the session only holds the user's id, and each request looks them up (what todos-express-google's own comment
//   recommends). A deleted user is signed out on their next request.
// - Google's access token is thrown away. Sign-in only needs to know who you are.
//
// `google` swaps Google's addresses for a stand-in in tests.
export class PassportSetup
  {
    constructor({ passport, settings, signIn, logins, google = {} })
      {
        this.passport = passport;
        this.settings = settings;
        this.signIn = signIn;
        this.logins = logins;
        this.google = google;
      }

    install()
      {
        if(this.settings.isConfigured()) this.passport.use(this.googleStrategy());
        this.passport.serializeUser((user, done) => this.rememberUser(user, done));
        this.passport.deserializeUser((id, done) => this.loadUser(id, done));
      }

    googleStrategy()
      {
        const options =
          {
            clientID: this.settings.clientId(),
            clientSecret: this.settings.clientSecret(),
            callbackURL: this.settings.callbackUrl(),
            scope: ["profile", "email"],
            state: true,
            ...this.google,
          };
        return new GoogleStrategy(options, (accessToken, refreshToken, profile, done) => this.checkGoogle(profile, done));
      }

    // Runs once Google says who you are. Turned away is `false` with a reason, not an error.
    async checkGoogle(profile, done)
      {
        try
          {
            const result = await this.signIn.attempt(new GoogleAccount(profile));
            if(result.user) return done(null, result.user);
            done(null, false, { reason: result.reason });
          }
        catch(error)
          {
            done(error);
          }
      }

    rememberUser(user, done)
      {
        done(null, user.id);
      }

    async loadUser(id, done)
      {
        try
          {
            done(null, (await this.logins.find(id)) || false);
          }
        catch(error)
          {
            done(error);
          }
      }
  }
