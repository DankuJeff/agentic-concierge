/**
 * Waitlist routes — public, no auth required.
 *
 * POST /waitlist       — submit an email address for the waitlist
 * GET  /waitlist/count — total signups (for social proof on landing page)
 */

import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { db, waitlistSignups } from '../../db/index.js';
import { childLogger } from '../../shared/logger.js';

const log = childLogger({ module: 'routes/waitlist' });

// Very basic email sanity check — rejects obvious non-emails without a regex essay.
function isValidEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function waitlistRoutes(app: FastifyInstance): Promise<void> {
  // POST /waitlist
  app.post('/waitlist', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = request.body as { email?: unknown; name?: unknown; referralSource?: unknown };

    if (typeof body.email !== 'string' || !isValidEmail(body.email)) {
      return reply.status(400).send({
        ok: false,
        error: { code: 'INVALID_EMAIL', message: 'A valid email address is required.' },
      });
    }

    const email = body.email.trim().toLowerCase();
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 100) : null;
    const referralSource =
      typeof body.referralSource === 'string'
        ? body.referralSource.trim().slice(0, 200)
        : null;

    try {
      await db.insert(waitlistSignups).values({ email, name, referralSource });
      log.info({ email }, 'Waitlist signup');
      return reply.status(201).send({ ok: true, data: { alreadyRegistered: false } });
    } catch (err: unknown) {
      // Unique constraint violation — already on the list
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('unique') || msg.includes('duplicate')) {
        return reply.send({ ok: true, data: { alreadyRegistered: true } });
      }
      log.error({ err, email }, 'Waitlist insert failed');
      return reply.status(500).send({
        ok: false,
        error: { code: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' },
      });
    }
  });

  // GET /waitlist/count
  app.get('/waitlist/count', async (_request, reply) => {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(waitlistSignups);
    return reply.send({ ok: true, data: { count: row?.count ?? 0 } });
  });
}
