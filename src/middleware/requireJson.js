import { StatusCodes } from "http-status-codes";

// Turns away any body that isn't JSON. app.js also reads form posts, and a plain HTML form on another site can post
// one to us with no CORS check first, so on the sign-in route it could sign you in to someone else's account (login
// CSRF). A JSON body from another site has to ask CORS first, and CLIENT_URL is the only site that gets a yes.
export const requireJson = (req, res, next) =>
  {
    if(!req.is("application/json")) return res.status(StatusCodes.UNSUPPORTED_MEDIA_TYPE).json({ message: "Send this as JSON." });
    next();
  };
