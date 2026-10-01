import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

/**
 * Per-request values that code deep in a service needs without threading them through
 * every signature. Today: which browser tab sent the request (X-Client-Id), stamped on
 * the live events it causes so that tab can skip its own echoes while the user's other
 * tabs still apply them.
 */
export const requestContext = new AsyncLocalStorage<{ clientId: string | null }>();

export function requestContextMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const raw = req.header('x-client-id');
  // Echoed to other subscribers: accept only something shaped like the UUID the web app sends.
  const clientId = raw && /^[0-9a-f-]{36}$/i.test(raw) ? raw : null;
  requestContext.run({ clientId }, next);
}
