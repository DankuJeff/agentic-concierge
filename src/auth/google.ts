/**
 * Google OAuth2 client via Arctic.
 * Arctic handles PKCE, token exchange, and user-info fetching.
 */

import { Google } from 'arctic';

const clientId = process.env['GOOGLE_CLIENT_ID'];
const clientSecret = process.env['GOOGLE_CLIENT_SECRET'];
const redirectUri =
  process.env['GOOGLE_REDIRECT_URI'] ?? 'http://localhost:3000/auth/google/callback';

if (!clientId || !clientSecret) {
  // Warn at startup rather than crashing — the rest of the app works without OAuth configured.
  console.warn(
    '[auth/google] GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set. ' +
      'Google OAuth login will be unavailable.',
  );
}

export const googleOAuth = new Google(clientId ?? '', clientSecret ?? '', redirectUri);

// Google user-info endpoint — returned after token exchange
export interface GoogleUserInfo {
  sub: string;   // stable Google user ID
  name: string;
  email: string;
  picture: string;
}

/** Fetch the authenticated user's profile from Google's userinfo endpoint. */
export async function fetchGoogleUser(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Google userinfo request failed: ${res.status}`);
  }
  return res.json() as Promise<GoogleUserInfo>;
}

/**
 * Full set of scopes requested during OAuth login.
 * Includes Gmail send + Calendar read/write so users don't need a second OAuth round-trip.
 */
export const GOOGLE_SCOPES = [
  'openid',
  'profile',
  'email',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar',
] as const;
