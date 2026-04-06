/**
 * Session management — cookie-based sessions backed by the sessions table.
 *
 * No third-party auth library; the pattern is straightforward:
 *   1. Generate a cryptographically random token.
 *   2. Store it in the DB with a userId and expiry.
 *   3. Read it from the request cookie, validate, return user.
 *
 * Sessions last 30 days and are refreshed (new expiry) if more than half
 * the lifetime has elapsed.
 */

import { eq } from 'drizzle-orm';
import { db, sessions, users } from '../db/index.js';
import { childLogger } from '../shared/logger.js';

const log = childLogger({ module: 'auth/sessions' });

export const SESSION_COOKIE_NAME = 'session';
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  googleId: string | null;
}

// ── Token generation ──────────────────────────────────────────

/** 20 random bytes → 27-char base64url string. Sufficient entropy for a session token. */
function generateToken(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

// ── CRUD ──────────────────────────────────────────────────────

export async function createSession(userId: string): Promise<string> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  await db.insert(sessions).values({ id: token, userId, expiresAt });
  log.info({ userId }, 'Session created');
  return token;
}

/**
 * Validates a session token.
 * Returns the SessionUser if valid, null if expired or not found.
 * Refreshes the session expiry if more than half the lifetime has elapsed.
 */
export async function validateSession(token: string): Promise<SessionUser | null> {
  const rows = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      userId: users.id,
      name: users.name,
      email: users.email,
      googleId: users.googleId,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, token))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  if (row.expiresAt < new Date()) {
    await db.delete(sessions).where(eq(sessions.id, token));
    log.info({ userId: row.userId }, 'Session expired — deleted');
    return null;
  }

  // Refresh if more than half the lifetime has elapsed
  if (Date.now() > row.expiresAt.getTime() - SESSION_DURATION_MS / 2) {
    const newExpiry = new Date(Date.now() + SESSION_DURATION_MS);
    await db.update(sessions).set({ expiresAt: newExpiry }).where(eq(sessions.id, token));
  }

  return {
    id: row.userId,
    name: row.name,
    email: row.email,
    googleId: row.googleId,
  };
}

export async function invalidateSession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, token));
  log.info('Session invalidated');
}

// ── Cookie helpers ────────────────────────────────────────────

export function buildSessionCookie(token: string): string {
  const secure = process.env['NODE_ENV'] === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/${secure}; Max-Age=${SESSION_DURATION_MS / 1000}`;
}

export function buildClearCookie(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

/** Parse the session token out of a raw Cookie header string. */
export function parseSessionToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [rawKey, ...rest] = part.split('=');
    if (rawKey === undefined) continue;
    const key = rawKey.trim();
    const value = rest.join('=').trim();
    if (key === SESSION_COOKIE_NAME && value) return value;
  }
  return null;
}
