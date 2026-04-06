/**
 * Stripe billing routes.
 *
 * GET  /billing/status                 — current subscription status for the authenticated user
 * POST /billing/create-checkout-session — create a Stripe Checkout session (hosted payment page)
 * POST /billing/create-portal-session  — create a Stripe Customer Portal session (self-service management)
 * POST /billing/webhook                — Stripe webhook (unprotected, signature-verified)
 *
 * The webhook route is registered outside the requireAuth scope in server.ts
 * because Stripe calls it directly — it is not a user-initiated request.
 *
 * Signature verification uses STRIPE_WEBHOOK_SECRET. Obtain it from:
 *   Stripe Dashboard → Developers → Webhooks → your endpoint → Signing secret
 *   OR for local dev: stripe listen --forward-to localhost:3000/billing/webhook
 */

import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, users } from '../../db/index.js';
import { stripe, getOrCreateCustomer } from '../../integrations/stripe/client.js';
import { handleSubscriptionEvent } from '../../integrations/stripe/webhooks.js';
import { childLogger } from '../../shared/logger.js';

const log = childLogger({ module: 'routes/billing' });

const FRONTEND_ORIGIN = process.env['FRONTEND_ORIGIN'] ?? 'http://localhost:5173';

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  // GET /billing/status — subscription status for the authenticated user
  app.get('/billing/status', async (request, reply) => {
    const userId = request.user.id;

    const rows = await db
      .select({
        stripeCustomerId: users.stripeCustomerId,
        stripeSubscriptionId: users.stripeSubscriptionId,
        subscriptionStatus: users.subscriptionStatus,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const row = rows[0];
    return reply.send({
      ok: true,
      data: {
        customerId: row?.stripeCustomerId ?? null,
        subscriptionId: row?.stripeSubscriptionId ?? null,
        status: row?.subscriptionStatus ?? null,
        isActive: row?.subscriptionStatus === 'active' || row?.subscriptionStatus === 'trialing',
      },
    });
  });

  // POST /billing/create-checkout-session — start a new subscription
  app.post('/billing/create-checkout-session', async (request, reply) => {
    const priceId = process.env['STRIPE_PRICE_ID'];
    if (!priceId) {
      return reply.status(500).send({
        ok: false,
        error: { code: 'CONFIG_ERROR', message: 'STRIPE_PRICE_ID is not configured.' },
      });
    }

    const userId = request.user.id;

    const rows = await db
      .select({ email: users.email, name: users.name, stripeCustomerId: users.stripeCustomerId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const user = rows[0];
    if (!user) {
      return reply.status(404).send({ ok: false, error: { code: 'USER_NOT_FOUND', message: 'User not found.' } });
    }

    const customerId = await getOrCreateCustomer(userId, user.email, user.name, user.stripeCustomerId);

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${FRONTEND_ORIGIN}?billing=success`,
      cancel_url: `${FRONTEND_ORIGIN}?billing=canceled`,
      metadata: { userId },
    });

    log.info({ userId, sessionId: session.id }, 'Checkout session created');
    return reply.send({ ok: true, data: { url: session.url } });
  });

  // POST /billing/create-portal-session — self-service subscription management
  app.post('/billing/create-portal-session', async (request, reply) => {
    const userId = request.user.id;

    const rows = await db
      .select({ stripeCustomerId: users.stripeCustomerId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const customerId = rows[0]?.stripeCustomerId;
    if (!customerId) {
      return reply.status(400).send({
        ok: false,
        error: { code: 'NO_BILLING', message: 'No billing account found. Complete checkout first.' },
      });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: FRONTEND_ORIGIN,
    });

    log.info({ userId }, 'Portal session created');
    return reply.send({ ok: true, data: { url: session.url } });
  });
}

/**
 * Stripe webhook route — registered unprotected (no requireAuth) in server.ts.
 * Must receive the raw body for signature verification — do NOT parse it as JSON first.
 *
 * addContentTypeParser is scoped to this plugin only, so it does not override
 * the JSON parser for any other routes.
 */
export async function stripeWebhookRoute(app: FastifyInstance): Promise<void> {
  // Override the JSON content-type parser within this plugin scope only.
  // Captures the raw Buffer for Stripe signature verification while still
  // parsing the JSON body for handler access.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body, done) => {
      (req as unknown as { rawBody: Buffer }).rawBody = body as Buffer;
      try {
        done(null, JSON.parse((body as Buffer).toString()));
      } catch (e) {
        done(e as Error, undefined);
      }
    },
  );

  app.post(
    '/billing/webhook',
    {},
    async (request, reply) => {
      const webhookSecret = process.env['STRIPE_WEBHOOK_SECRET'];
      if (!webhookSecret) {
        log.error('STRIPE_WEBHOOK_SECRET not set — cannot verify webhook signature');
        return reply.status(500).send({ ok: false });
      }

      const sig = request.headers['stripe-signature'];
      if (!sig || typeof sig !== 'string') {
        return reply.status(400).send({ ok: false, error: 'Missing stripe-signature header' });
      }

      let event;
      try {
        // request.rawBody is populated by the addContentTypeParser below
        const rawBody = (request as unknown as { rawBody: Buffer }).rawBody;
        event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
      } catch (e) {
        log.warn({ err: e }, 'Stripe webhook signature verification failed');
        return reply.status(400).send({ ok: false, error: 'Invalid signature' });
      }

      log.info({ eventType: event.type, eventId: event.id }, 'Stripe webhook received');
      await handleSubscriptionEvent(event);

      return reply.send({ ok: true });
    },
  );
}
