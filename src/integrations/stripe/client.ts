/**
 * Stripe SDK client — singleton, test mode.
 *
 * Requires STRIPE_SECRET_KEY (starts with sk_test_ for test mode).
 * All API calls use this instance; never instantiate Stripe elsewhere.
 */

import Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { db, users } from '../../db/index.js';

const stripeKey = process.env['STRIPE_SECRET_KEY'];
if (!stripeKey || stripeKey === 'sk_test_placeholder') {
  console.warn(
    '[stripe] STRIPE_SECRET_KEY is not set. Billing endpoints will be unavailable.',
  );
}

// Stripe SDK throws if the key is empty. Use a well-formed placeholder so the
// server starts cleanly; actual billing API calls will fail with auth errors
// until a real key is provided.
export const stripe = new Stripe(stripeKey || 'placeholder_stripe_key_not_configured', {
  apiVersion: '2025-03-31.basil',
});

/**
 * Find or create a Stripe customer for the given user.
 * Stores the resulting customer ID back on the user row if newly created.
 */
export async function getOrCreateCustomer(
  userId: string,
  email: string,
  name: string,
  existingCustomerId: string | null,
): Promise<string> {
  if (existingCustomerId) return existingCustomerId;

  const customer = await stripe.customers.create({ email, name, metadata: { userId } });
  await db.update(users).set({ stripeCustomerId: customer.id, updatedAt: new Date() }).where(eq(users.id, userId));

  return customer.id;
}
