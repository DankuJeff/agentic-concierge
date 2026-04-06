/**
 * Stripe webhook event handlers.
 *
 * Called by POST /billing/webhook after signature verification.
 * Updates subscription status on the users table in response to Stripe lifecycle events.
 *
 * Handled events:
 *   customer.subscription.created   — new subscription, set status
 *   customer.subscription.updated   — plan change / renewal, update status
 *   customer.subscription.deleted   — cancellation, set status = 'canceled'
 *   invoice.payment_failed          — payment issue, set status = 'past_due'
 */

import type Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { db, users } from '../../db/index.js';
import { childLogger } from '../../shared/logger.js';

const log = childLogger({ module: 'stripe/webhooks' });

export async function handleSubscriptionEvent(
  event: Stripe.Event,
): Promise<void> {
  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      await updateSubscription(sub.customer as string, sub.id, sub.status);
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      await updateSubscription(sub.customer as string, sub.id, 'canceled');
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      const subId = (invoice as unknown as { subscription?: string }).subscription;
      if (subId) {
        await updateSubscriptionStatus(invoice.customer as string, 'past_due');
      }
      break;
    }

    default:
      // Silently ignore unhandled events — Stripe sends many we don't care about
      break;
  }
}

async function updateSubscription(
  customerId: string,
  subscriptionId: string,
  status: string,
): Promise<void> {
  const result = await db
    .update(users)
    .set({ stripeSubscriptionId: subscriptionId, subscriptionStatus: status, updatedAt: new Date() })
    .where(eq(users.stripeCustomerId, customerId))
    .returning({ id: users.id });

  if (result.length === 0) {
    log.warn({ customerId, subscriptionId, status }, 'Stripe webhook: no user found for customer ID');
  } else {
    log.info({ customerId, subscriptionId, status }, 'Subscription updated via webhook');
  }
}

async function updateSubscriptionStatus(customerId: string, status: string): Promise<void> {
  await db
    .update(users)
    .set({ subscriptionStatus: status, updatedAt: new Date() })
    .where(eq(users.stripeCustomerId, customerId));
  log.info({ customerId, status }, 'Subscription status updated via webhook');
}
