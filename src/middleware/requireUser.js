import { StatusCodes } from "http-status-codes";

// The lock on everything past /health and /auth. No session, no answer. A signed-in request runs as its person, so
// every store it touches only sees their rows.
export const requireUser = (currentUser) => (req, res, next) =>
  {
    if(!req.user) return res.status(StatusCodes.UNAUTHORIZED).json({ message: "Not signed in." });
    return currentUser.as(req.user.id, next);
  };
