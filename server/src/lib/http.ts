import type { NextFunction, Request, Response, RequestHandler } from 'express';
import { ZodError, type ZodType } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Resource') => new HttpError(404, `${what} not found`, 'NOT_FOUND');
export const badRequest = (message: string, code = 'BAD_REQUEST') => new HttpError(400, message, code);

/** Wraps async route handlers so rejected promises reach the error middleware. */
export function ah<T extends Request = Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req as T, res, next).catch(next);
  };
}

export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  return schema.parse(body);
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    return res.status(400).json({
      error: first ? `${first.path.join('.') || 'input'}: ${first.message}` : 'Invalid input',
      code: 'VALIDATION_ERROR',
    });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  const anyErr = err as { type?: string; message?: string; status?: number };
  if (anyErr?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'File or request is too large', code: 'TOO_LARGE' });
  }
  if (anyErr?.message?.includes('File too large')) {
    return res.status(413).json({ error: 'File is too large', code: 'TOO_LARGE' });
  }
  console.error('[error]', err);
  return res.status(500).json({ error: 'Something went wrong. Please try again.', code: 'INTERNAL' });
}
