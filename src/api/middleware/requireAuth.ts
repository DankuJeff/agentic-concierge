/**
 * Fastify preHandler — validates the session cookie and injects request.user.
 * Applied to all protected route scopes. Unprotected routes (health, /auth/*) skip this.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { validateSession, parseSessionToken, buildSessionCookie } from '../../auth/sessions.js';
import type { SessionUser } from '../../auth/sessions.js';
import { childLogger } from '../../shared/logger.js';

const log = childLogger({ module: 'middleware/requireAuth' });

// Augment FastifyRequest so all protected handlers have typed request.user
declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser;
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = parseSessionToken(request.headers.cookie);
  if (!token) {
    log.warn({ path: request.url }, 'Unauthenticated request — no session cookie');
    return reply.status(401).send({
      ok: false,
      error: { code: 'UNAUTHENTICATED', message: 'Login required' },
    });
  }

  const sessionUser = await validateSession(token);
  if (!sessionUser) {
    log.warn({ path: request.url }, 'Invalid or expired session');
    return reply.status(401).send({
      ok: false,
      error: { code: 'UNAUTHENTICATED', message: 'Session expired — please log in again' },
    });
  }

  // Refresh cookie on the way out if the session was refreshed in validateSession
  void reply.header('Set-Cookie', buildSessionCookie(token));

  request.user = sessionUser;
}
