// What someone typed on the login screen, read off the JSON body: { email, password, remember }. Anything that isn't
// the right type counts as empty, so a made-up body can't get past as something else.
const MAX_EMAIL = 320;

export class PasswordLogin
  {
    constructor(body)
      {
        this.body = body || {};
      }

    // Lowercase and trimmed, since that's how the users table keeps emails.
    email()
      {
        if(typeof this.body.email !== "string") return "";
        return this.body.email.trim().toLowerCase().slice(0, MAX_EMAIL);
      }

    // Exactly as typed. Spaces in a password are part of it.
    password()
      {
        return typeof this.body.password === "string" ? this.body.password : "";
      }

    // Flask-Login's remember. Only a real true counts; leaving it out means a session that ends with the browser.
    remember()
      {
        return this.body.remember === true;
      }
  }
