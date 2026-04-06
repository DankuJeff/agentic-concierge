import { eq } from 'drizzle-orm';
import { db, users } from '../db/index.js';
import { PROTOTYPE_USER_ID } from '../db/seed.js';
import { UserProfileSchema, type UserProfile, type Result } from '../shared/types.js';
import { ok, err } from '../shared/types.js';
import { Errors } from '../shared/errors.js';

export async function getUser(userId: string): Promise<Result<UserProfile>> {
  try {
    const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const row = rows[0];
    if (!row) {
      return err(Errors.USER_NOT_FOUND());
    }

    const parsed = UserProfileSchema.safeParse({
      id: row.id,
      name: row.name,
      email: row.email,
      location: row.location,
      preferences: row.preferences,
      connectedServices: row.connectedServices,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });

    if (!parsed.success) {
      return err(Errors.VALIDATION_ERROR(parsed.error.message));
    }

    return ok(parsed.data);
  } catch (e) {
    return err(Errors.DB_ERROR(e instanceof Error ? e.message : String(e)));
  }
}

// Prototype helper — avoids hardcoding the UUID everywhere in calling code.
export function getSingleUser(): Promise<Result<UserProfile>> {
  return getUser(PROTOTYPE_USER_ID);
}
