// The Google account someone just signed in with, read off the profile passport-google-oauth20 hands over. Google's
// userinfo gives `sub` (the account's id, which never changes, even when the email does), the email, and whether
// Google has checked that email.

// Who vouches for these accounts. Same value passport/todos-express-google stores in federated_credentials.
export const GOOGLE = "https://accounts.google.com";

export class GoogleAccount
  {
    constructor(profile)
      {
        this.profile = profile || {};
      }

    provider()
      {
        return GOOGLE;
      }

    subject()
      {
        return String(this.profile.id || "");
      }

    // Lowercase, since that's how the users table keeps emails.
    email()
      {
        return String(this.profile.emails?.[0]?.value || "").trim().toLowerCase();
      }

    // Only a real true counts. A missing flag or the string "true" doesn't.
    isVerified()
      {
        return this.profile.emails?.[0]?.verified === true;
      }

    name()
      {
        return String(this.profile.displayName || "").trim().slice(0, 200);
      }
  }
