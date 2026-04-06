/**
 * Plaid financial data routes.
 *
 * POST /plaid/link-token      — create a Link token for the Plaid Link frontend widget
 * POST /plaid/exchange-token  — exchange public token after Link completes; persist access token
 * GET  /plaid/accounts        — accounts + balances for the authenticated user
 * GET  /plaid/transactions    — recent transactions (query param: ?days=90)
 * GET  /plaid/status          — whether the user has connected Plaid
 *
 * The Plaid access token is encrypted at rest using encryptField() before storage.
 */

import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, users } from '../../db/index.js';
import {
  createLinkToken,
  exchangePublicToken,
  getAccounts,
  getTransactions,
} from '../../integrations/plaid/client.js';
import { encryptField, decryptNullable } from '../../shared/encryption.js';
import { childLogger } from '../../shared/logger.js';

const log = childLogger({ module: 'routes/plaid' });

export async function plaidRoutes(app: FastifyInstance): Promise<void> {
  // GET /plaid/status — has the user connected Plaid?
  app.get('/plaid/status', async (request, reply) => {
    const userId = request.user.id;
    const rows = await db
      .select({ plaidItemId: users.plaidItemId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return reply.send({
      ok: true,
      data: { connected: !!rows[0]?.plaidItemId },
    });
  });

  // POST /plaid/link-token — generate a Link token for the frontend Plaid Link widget
  app.post('/plaid/link-token', async (request, reply) => {
    const userId = request.user.id;
    try {
      const linkToken = await createLinkToken(userId);
      log.info({ userId }, 'Plaid link token created');
      return reply.send({ ok: true, data: { linkToken } });
    } catch (e) {
      log.error({ userId, err: e }, 'Failed to create Plaid link token');
      return reply.status(502).send({
        ok: false,
        error: { code: 'PLAID_ERROR', message: 'Failed to create Link token.' },
      });
    }
  });

  // POST /plaid/exchange-token — complete the Link flow and persist the access token
  app.post('/plaid/exchange-token', async (request, reply) => {
    const parseResult = z.object({ publicToken: z.string().min(1) }).safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: parseResult.error.message },
      });
    }

    const userId = request.user.id;
    const { publicToken } = parseResult.data;

    try {
      const { accessToken, itemId } = await exchangePublicToken(publicToken);

      await db
        .update(users)
        .set({
          plaidAccessToken: encryptField(accessToken),
          plaidItemId: itemId,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      log.info({ userId, itemId }, 'Plaid access token stored');
      return reply.send({ ok: true, data: { itemId } });
    } catch (e) {
      log.error({ userId, err: e }, 'Failed to exchange Plaid public token');
      return reply.status(502).send({
        ok: false,
        error: { code: 'PLAID_ERROR', message: 'Failed to exchange token.' },
      });
    }
  });

  // GET /plaid/accounts — accounts + balances
  app.get('/plaid/accounts', async (request, reply) => {
    const userId = request.user.id;
    const accessToken = await getDecryptedPlaidToken(userId);
    if (!accessToken) {
      return reply.status(400).send({
        ok: false,
        error: { code: 'PLAID_NOT_CONNECTED', message: 'Plaid is not connected. Complete the Link flow first.' },
      });
    }

    try {
      const accounts = await getAccounts(accessToken);
      log.info({ userId, count: accounts.length }, 'Fetched Plaid accounts');
      return reply.send({ ok: true, data: accounts });
    } catch (e) {
      log.error({ userId, err: e }, 'Failed to fetch Plaid accounts');
      return reply.status(502).send({
        ok: false,
        error: { code: 'PLAID_ERROR', message: 'Failed to fetch accounts.' },
      });
    }
  });

  // GET /plaid/transactions?days=90 — recent transactions
  app.get('/plaid/transactions', async (request, reply) => {
    const { days: daysStr } = request.query as { days?: string };
    const days = Math.max(1, Math.min(parseInt(daysStr ?? '90', 10) || 90, 365));

    const userId = request.user.id;
    const accessToken = await getDecryptedPlaidToken(userId);
    if (!accessToken) {
      return reply.status(400).send({
        ok: false,
        error: { code: 'PLAID_NOT_CONNECTED', message: 'Plaid is not connected. Complete the Link flow first.' },
      });
    }

    try {
      const transactions = await getTransactions(accessToken, days);
      log.info({ userId, count: transactions.length, days }, 'Fetched Plaid transactions');
      return reply.send({ ok: true, data: transactions });
    } catch (e) {
      log.error({ userId, err: e }, 'Failed to fetch Plaid transactions');
      return reply.status(502).send({
        ok: false,
        error: { code: 'PLAID_ERROR', message: 'Failed to fetch transactions.' },
      });
    }
  });
}

/** Fetch and decrypt the stored Plaid access token for a user. Returns null if not connected. */
async function getDecryptedPlaidToken(userId: string): Promise<string | null> {
  const rows = await db
    .select({ plaidAccessToken: users.plaidAccessToken })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return decryptNullable(rows[0]?.plaidAccessToken);
}
