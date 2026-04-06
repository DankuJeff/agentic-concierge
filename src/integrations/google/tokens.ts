/**
 * Google OAuth token management.
 *
 * Provides a single entry point — getValidToken(userId) — that returns a
 * fresh access token for any user who has connected their Google account.
 * If the stored access token is expired (or within 60s of expiry), it is
 * refreshed using the stored refresh token and the new token is persisted.
 */

import { eq } from 'drizzle-orm';
import { db, users } from '../../db/index.js';
import { childLogger } from '../../shared/logger.js';
import { decryptNullable, encryptNullable } from '../../shared/encryption.js';

const log = childLogger({ module: 'integrations/google/tokens' });

/** Seconds before expiry at which we proactively refresh the access token. */
const REFRESH_BUFFER_SECONDS = 60;

interface TokenRefreshResponse {
  access_token: string;
  expires_in: number; // seconds until expiry
  token_type: string;
  scope?: string;
}

/**
 * Returns a valid Google access token for the given user.
 * Automatically refreshes if the stored token is expired or close to expiry.
 *
 * Returns null if:
 *   - The user has no Google tokens (hasn't connected Gmail/Calendar)
 *   - The refresh token is missing or invalid
 */
export async function getValidToken(userId: string): Promise<string | null> {
  const rows = await db
    .select({
      accessToken: users.googleAccessToken,
      refreshToken: users.googleRefreshToken,
      expiresAt: users.googleTokenExpiresAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const row = rows[0];
  const accessToken = decryptNullable(row?.accessToken);
  const refreshToken = decryptNullable(row?.refreshToken);

  if (!accessToken) {
    log.warn({ userId }, 'No Google access token — user has not connected Gmail/Calendar');
    return null;
  }

  // Check if token is still valid (with buffer)
  const nowPlusBuffer = new Date(Date.now() + REFRESH_BUFFER_SECONDS * 1000);
  if (row?.expiresAt && row.expiresAt > nowPlusBuffer) {
    return accessToken;
  }

  // Token is expired or expiring soon — refresh it
  if (!refreshToken) {
    log.warn({ userId }, 'Access token expired but no refresh token — user must re-authenticate');
    return null;
  }

  log.info({ userId }, 'Access token expired — refreshing');

  const clientId = process.env['GOOGLE_CLIENT_ID'];
  const clientSecret = process.env['GOOGLE_CLIENT_SECRET'];
  if (!clientId || !clientSecret) {
    log.error('GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set — cannot refresh token');
    return null;
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    log.error({ userId, status: res.status, body }, 'Token refresh failed');
    return null;
  }

  const data = (await res.json()) as TokenRefreshResponse;
  const newExpiresAt = new Date(Date.now() + data.expires_in * 1000);

  await db
    .update(users)
    .set({
      googleAccessToken: encryptNullable(data.access_token),
      googleTokenExpiresAt: newExpiresAt,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  log.info({ userId }, 'Google access token refreshed and persisted');
  return data.access_token;
}

/**
 * Returns whether a user has connected their Google account with Gmail/Calendar scopes.
 * Does NOT verify token validity — use getValidToken() for that.
 */
export async function hasGoogleIntegration(userId: string): Promise<{
  gmail: boolean;
  calendar: boolean;
  scopes: string[];
}> {
  const rows = await db
    .select({ scopes: users.googleScopes, refreshToken: users.googleRefreshToken })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const row = rows[0];
  if (!decryptNullable(row?.refreshToken)) {
    return { gmail: false, calendar: false, scopes: [] };
  }

  const scopes = row?.scopes?.split(' ') ?? [];
  return {
    gmail: scopes.includes('https://www.googleapis.com/auth/gmail.send'),
    calendar: scopes.includes('https://www.googleapis.com/auth/calendar'),
    scopes,
  };
}
