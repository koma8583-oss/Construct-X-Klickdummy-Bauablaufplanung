import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";

/**
 * Marks errors caused by an API payload or by translating that payload to a
 * published contract.  Keeping this separate from generic Error prevents an
 * invalid client payload from being reported as an internal server failure.
 */
export class ApiBoundaryValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ApiBoundaryValidationError";
  }
}

export function isApiBoundaryValidationError(
  error: unknown,
): error is ZodError | ApiBoundaryValidationError {
  return error instanceof ZodError || error instanceof ApiBoundaryValidationError;
}

export const apiNotFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: "API route not found" });
};

export const apiErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  // body-parser attaches these properties to malformed JSON errors.
  if (
    error instanceof SyntaxError &&
    "status" in error &&
    (error as SyntaxError & { status?: number }).status === 400
  ) {
    res.status(400).json({ error: "Invalid JSON payload" });
    return;
  }

  if (error instanceof ZodError) {
    res.status(422).json({ error: "Invalid request payload", issues: error.issues });
    return;
  }

  if (error instanceof ApiBoundaryValidationError) {
    res.status(422).json({ error: error.message });
    return;
  }

  next(error);
};