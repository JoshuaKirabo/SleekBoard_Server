// The sites whose pages may call the API and read its answers, with the session cookie. CLIENT_URL takes one or a
// comma-separated list. localhost and 127.0.0.1 are the same Mac, so either one also lets the other in on the same port.
//
// Empty means no other site at all, never every site: the API answers with cookies, so "anyone" would let any page
// you visit read your board if the cookie ever rode along. A board served from the API's own address doesn't need
// CORS, so it still works.
const LOOPBACK = ["localhost", "127.0.0.1"];

export const corsOrigins = (clientUrl) => String(clientUrl || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean)
  .flatMap((origin) =>
    {
      const url = new URL(origin);
      if(!LOOPBACK.includes(url.hostname)) return [url.origin];
      return LOOPBACK.map((host) =>
        {
          url.hostname = host;
          return url.origin;
        });
    });
