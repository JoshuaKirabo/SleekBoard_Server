import { StatusCodes } from "http-status-codes";

// Nothing matched, so hand a proper 404 to the error handler instead of express's html page.
export const notFound = (req, res, next) =>
  {
    const error = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
    error.status = StatusCodes.NOT_FOUND;
    next(error);
  };
