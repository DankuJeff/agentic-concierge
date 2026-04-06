/**
 * Integration status routes.
 *
 * GET /integrations/google/status — returns Gmail and Calendar connection state for the user
 */

import type { FastifyInstance } from 'fastify';
import { hasGoogleIntegration } from '../../integrations/google/tokens.js';
import { childLogger } from '../../shared/logger.js';

const log = childLogger({ module: 'routes/integrations' });

export async function integrationRoutes(app: FastifyInstance): Promise<void> {
  // GET /integrations/google/status
  // Returns whether Gmail and Calendar are connected for the authenticated user.
  app.get('/integrations/google/status', async (request, reply) => {
    const userId = request.user.id;
    log.info({ userId }, 'Integration status check');

    const status = await hasGoogleIntegration(userId);

    return reply.send({
      ok: true,
      data: {
        gmail: {
          connected: status.gmail,
          scope: 'https://www.googleapis.com/auth/gmail.send',
        },
        calendar: {
          connected: status.calendar,
          scope: 'https://www.googleapis.com/auth/calendar',
        },
        scopes: status.scopes,
        // Re-auth URL in case the user needs to connect or re-grant scopes
        connectUrl: '/auth/google',
      },
    });
  });
}
