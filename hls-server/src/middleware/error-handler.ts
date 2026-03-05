import type { Request, Response, NextFunction } from 'express';

/**
 * Global error handler middleware (PDR §6.5).
 * Maps internal errors to intentionally vague HTTP responses.
 */
export function createErrorHandler() {
  return (err: Error, _req: Request, res: Response, _next: NextFunction): void => {
    console.error('Unhandled error:', err.message);

    // Don't leak internal error details
    res.status(500).json({ error: 'Internal server error' });
  };
}

/**
 * Wrap async route handlers to catch errors and pass to error handler.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}
