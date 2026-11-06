import { randomBytes } from "node:crypto";

// A stand-in hash to check a typed password against when there's no real one: nobody by that email, or an account
// with no password. better-auth's email sign-in hashes the typed password in those cases so they take
// as long as a wrong password; checking against a decoy runs the very same argon2.verify a wrong password does.
//
// The decoy is a hash of a random password that's never kept or shown, so nobody can type it, and PasswordSignIn
// turns a decoy match away anyway. It's made with the same hasher (argon2id, node-argon2's defaults) as real ones,
// so checking against it costs what checking against a real one does.
const DECOY_BYTES = 32;

export class DecoyHash
  {
    constructor({ hasher })
      {
        this.hasher = hasher;
        this.made = null;
      }

    // The decoy, made the first time it's asked for and kept for the life of the server.
    stored()
      {
        this.made ??= this.make();
        return this.made;
      }

    // If making it fails, the next ask tries again instead of every sign-in failing for good.
    async make()
      {
        try
          {
            return await this.hasher.make(randomBytes(DECOY_BYTES).toString("base64url"));
          }
        catch(error)
          {
            this.made = null;
            throw error;
          }
      }
  }
