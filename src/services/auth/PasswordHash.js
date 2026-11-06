import argon2 from "argon2";

// Turns a password into something safe to keep, and checks a typed one against it. Flask-Login leaves this to the app
// (its README compares plain text and says never to), so it's ranisalt/node-argon2 here: argon2id with the package's
// own defaults, which its README says not to change for passwords. Each hash comes out as one PHC string carrying its
// type, settings and random salt ($argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>), so a later change of settings still
// checks the old ones.
const ARGON2 = "$argon2";

export class PasswordHash
  {
    // A new hash for this password, with its own salt. Two people with the same password get different hashes.
    make(password)
      {
        return argon2.hash(String(password));
      }

    // Whether the typed password matches. argon2.verify compares in constant time, so how long it takes says nothing
    // about how close the guess was. Anything that isn't an argon2 hash, plain text included, never matches.
    async matches(password, stored)
      {
        if(!this.isArgon2(stored)) return false;
        return argon2.verify(stored, String(password));
      }

    isArgon2(stored)
      {
        return typeof stored === "string" && stored.startsWith(ARGON2);
      }
  }
