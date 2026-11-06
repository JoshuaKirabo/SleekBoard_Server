import { StatusCodes } from "http-status-codes";

const PRISMA_ERRORS =
  {
    P2000: [StatusCodes.BAD_REQUEST, "One of those values is too long to save."],
    P2002: [StatusCodes.CONFLICT, "That already exists."],
    P2003: [StatusCodes.CONFLICT, "That points at something that isn't there any more."],
    P2025: [StatusCodes.NOT_FOUND, "That record doesn't exist."],
  };

// One place every error ends up. Prisma's own errors get mapped to sensible codes here, so the controllers don't have
// to think about it. Field checks (JobFields, ContactFields) send their own 400s.
export const errorHandler = (error, req, res, next) =>
  {
    let status = error.status || StatusCodes.INTERNAL_SERVER_ERROR;
    let message = error.message || "Something went wrong";

    if(error.type === "entity.too.large")
      {
        status = StatusCodes.REQUEST_TOO_LONG;
        message = "That's too big to save. Try a smaller logo.";
      }

    // Prisma's (Postgres) errors carry a code like P2025. Only the ones a request can cause get their own answer, and
    // none of them repeats Postgres' own wording, which names tables and columns.
    if(PRISMA_ERRORS[error.code])
      {
        [status, message] = PRISMA_ERRORS[error.code];
      }

    if(status >= 500) console.error(error);

    // Stacks are opt-in: only `npm run dev` sets NODE_ENV=development. A deploy that forgets NODE_ENV stays quiet
    // instead of handing out file paths.
    res.status(status).json({ message, ...(process.env.NODE_ENV === "development" && { stack: error.stack }) });
  };
