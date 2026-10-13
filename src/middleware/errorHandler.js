import { StatusCodes } from "http-status-codes";

// One place every error ends up. Mongoose's own errors get mapped to sensible codes here
// so the controllers don't have to think about it.
export const errorHandler = (error, req, res, next) =>
  {
    let status = error.status || StatusCodes.INTERNAL_SERVER_ERROR;
    let message = error.message || "Something went wrong";

    if(error.name === "ValidationError")
      {
        status = StatusCodes.BAD_REQUEST;
        message = Object.values(error.errors).map((field) => field.message).join(", ");
      }

    if(error.name === "CastError")
      {
        status = StatusCodes.NOT_FOUND;
        message = `No record found with id ${error.value}`;
      }

    if(error.code === 11000)
      {
        status = StatusCodes.CONFLICT;
        message = `${Object.keys(error.keyValue).join(", ")} already exists`;
      }

    if(status >= 500) console.error(error);

    res.status(status).json({ message, ...(process.env.NODE_ENV !== "production" && { stack: error.stack }) });
  };
