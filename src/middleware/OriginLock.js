import { createHash, timingSafeEqual } from "node:crypto";
import { StatusCodes } from "http-status-codes";

// The header Cloudflare's Request Header Transform Rule sets on every request it passes on (Set static, all incoming
// requests). "Set" overwrites whatever a visitor sent under the same name, so only Cloudflare's value reaches us.
export const ORIGIN_HEADER = "x-origin-secret";

// Serves only requests that came through Cloudflare. Cloud Run's run.app address is public too, and a request sent
// there straight skips Cloudflare's protection and could fake its address to the sign-in limits (TRUST_PROXY_HOPS=2).
// Cloudflare's guide for an origin that can't check client certificates (Authenticated Origin Pulls; Cloud Run can't):
// have Cloudflare add a secret header and turn away anything without it.
export class OriginLock
  {
    constructor({ secret })
      {
        this.expected = OriginLock.digest(secret);
      }

    // Both sides hashed first, so they're the same length for timingSafeEqual whatever was sent, and a wrong guess
    // takes as long as a nearly right one.
    static digest(value)
      {
        return createHash("sha256").update(String(value ?? "")).digest();
      }

    admits(value)
      {
        return timingSafeEqual(OriginLock.digest(value), this.expected);
      }

    // Mounted first in app.js, before CORS and body parsing, so a turned-away request costs one hash and a 403 with
    // nothing in it that says why.
    guard()
      {
        return (req, res, next) =>
          {
            if(!this.admits(req.get(ORIGIN_HEADER))) return res.sendStatus(StatusCodes.FORBIDDEN);
            next();
          };
      }
  }
