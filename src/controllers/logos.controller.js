import { StatusCodes } from "http-status-codes";

// Where the logos come from. Google's favicon service is keyless, but it sends no CORS header, so the browser can show
// the image and never read its pixels. Passing it through here puts our own origin on it and the client can sample
// the brand colour off a canvas.
const FAVICON = "https://www.google.com/s2/favicons";
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

export const getLogo = async (req, res, next) =>
  {
    const { domain } = req.params;
    if(!DOMAIN.test(domain)) return res.status(StatusCodes.BAD_REQUEST).json({ message: "That isn't a domain." });

    try
      {
        const upstream = await fetch(`${FAVICON}?domain=${encodeURIComponent(domain)}&sz=128`);
        if(!upstream.ok) return res.status(StatusCodes.NOT_FOUND).json({ message: `No logo for ${domain}.` });

        res.set("Content-Type", upstream.headers.get("content-type") || "image/png");
        res.set("Cache-Control", "public, max-age=86400");
        res.send(Buffer.from(await upstream.arrayBuffer()));
      }
    catch(error)
      {
        next(error);
      }
  };
