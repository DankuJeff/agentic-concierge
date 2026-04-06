/**
 * Prototype seed — inserts Tyler's personal profile as the single user.
 * Idempotent: safe to re-run. Updates the record if it already exists.
 *
 * Usage: npm run db:seed
 */

import { config as loadEnv } from 'dotenv';
loadEnv({ override: true });
import { fileURLToPath } from 'url';
import { db, users } from './index.js';
import { logger } from '../shared/logger.js';

// Fixed UUID — stable across re-runs so nothing else breaks
export const PROTOTYPE_USER_ID = '00000000-0000-0000-0000-000000000001';

const seedUser = {
  id: PROTOTYPE_USER_ID,
  name: 'Tyler Munstock',
  email: 'tyler@local.dev',
  location: {
    zip: '92587',
    city: 'Canyon Lake',
    state: 'CA',
    country: 'US',
  },
  preferences: {
    communicationTone: 'direct',
    riskTolerance: 'moderate',
    detailLevel: 'detailed',
  },
  connectedServices: [],
} as const;

async function seed() {
  logger.info('Seeding prototype user profile...');

  await db
    .insert(users)
    .values(seedUser)
    .onConflictDoUpdate({
      target: users.id,
      set: {
        name: seedUser.name,
        email: seedUser.email,
        location: seedUser.location,
        preferences: seedUser.preferences,
      },
    });

  logger.info({ userId: PROTOTYPE_USER_ID }, 'User seeded successfully');
  process.exit(0);
}

// Only run when executed directly (not when imported by other modules)
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  seed().catch((err: unknown) => {
    logger.error({ err }, 'Seed failed');
    process.exit(1);
  });
}
