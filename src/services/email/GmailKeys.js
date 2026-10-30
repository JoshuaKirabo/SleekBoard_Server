import crypto from "node:crypto";

// The two secrets Connect Gmail needs, both made from GMAIL_SECRET in .env: one locks the saved Gmail login, the
// other signs the state sent to Google. Each is bound to its job, so one can never pass for the other, the way
// JobNavigator derives its state key from the cookie secret (gmail_auth._state_key).
//
// JobNavigator saves the Gmail login as plain text. Ours is locked with AES-256-GCM, so a copy of the database alone
// can't read anyone's inbox (FEATURES.md, Foundations: Secrets).

// A Gmail login locked by this file starts with this, so a different format later can tell old ones apart.
const VERSION = "v1";

export class GmailKeys
  {
    // secret is GMAIL_SECRET: at least 32 random bytes, base64. Missing or short is refused, since a weak one would
    // let anyone forge a state or unlock a token.
    constructor(secret)
      {
        const raw = Buffer.from(String(secret || ""), "base64");
        if(raw.length < 32) throw new Error("GMAIL_SECRET in .env has to be at least 32 random bytes in base64. Make one with: openssl rand -base64 32");
        this.lockKey = this.derive(raw, "sleekboard gmail token lock");
        this.stateKey = this.derive(raw, "sleekboard gmail oauth state");
      }

    derive(raw, purpose)
      {
        return crypto.createHmac("sha256", raw).update(purpose).digest();
      }

    // The Gmail login, locked: "v1.iv.tag.data", each part base64url.
    lock(text)
      {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv("aes-256-gcm", this.lockKey, iv);
        const data = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]);
        return [VERSION, iv, cipher.getAuthTag(), data].map((part) => typeof part === "string" ? part : part.toString("base64url")).join(".");
      }

    // Unlocked again, or "" when it isn't ours or was tampered with (GCM's tag catches any change).
    unlock(locked)
      {
        const [version, iv, tag, data] = String(locked || "").split(".");
        if(version !== VERSION || !iv || !tag || !data) return "";
        try
          {
            const decipher = crypto.createDecipheriv("aes-256-gcm", this.lockKey, Buffer.from(iv, "base64url"));
            decipher.setAuthTag(Buffer.from(tag, "base64url"));
            return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
          }
        catch
          {
            return "";
          }
      }

    // A signature for a state payload.
    sign(text)
      {
        return crypto.createHmac("sha256", this.stateKey).update(text).digest("base64url");
      }

    // True when two strings match, timed so the comparison can't leak how much of a forged one was right.
    same(a, b)
      {
        const left = Buffer.from(String(a));
        const right = Buffer.from(String(b));
        return left.length === right.length && crypto.timingSafeEqual(left, right);
      }

    // A short fingerprint of a login, so "this one expired" can be saved without saving the login again.
    fingerprint(token)
      {
        return crypto.createHash("sha256").update(String(token || "")).digest("hex").slice(0, 16);
      }
  }
