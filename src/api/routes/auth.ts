/**
 * Google OAuth2 authentication routes.
 *
 * GET  /auth/google           — initiate OAuth flow (redirect to Google)
 * GET  /auth/google/callback  — handle OAuth callback (exchange code, create session)
 * POST /auth/logout           — invalidate session cookie
 * GET  /auth/me               — return current session user (used by frontend on mount)
 */

import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { generateCodeVerifier, generateState } from 'arctic';
import { googleOAuth, fetchGoogleUser, GOOGLE_SCOPES } from '../../auth/google.js';
import {
  createSession,
  invalidateSession,
  validateSession,
  parseSessionToken,
  buildSessionCookie,
  buildClearCookie,
  SESSION_COOKIE_NAME,
} from '../../auth/sessions.js';
import { db, users } from '../../db/index.js';
import { childLogger } from '../../shared/logger.js';
import { encryptNullable } from '../../shared/encryption.js';
import { writeAuditLog } from '../../shared/audit.js';

const log = childLogger({ module: 'routes/auth' });

const FRONTEND_ORIGIN = process.env['FRONTEND_ORIGIN'] ?? 'http://localhost:5173';

// State + code verifier are stored as short-lived cookies (10 min) during the OAuth dance
const OAUTH_STATE_COOKIE = 'oauth_state';
const OAUTH_VERIFIER_COOKIE = 'oauth_verifier';
const OAUTH_COOKIE_TTL = 60 * 10; // 10 minutes in seconds

function oauthCookie(name: string, value: string): string {
  return `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${OAUTH_COOKIE_TTL}`;
}

function clearOAuthCookies(): string[] {
  return [
    `${OAUTH_STATE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
    `${OAUTH_VERIFIER_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
  ];
}

function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.split('=');
    if (k === undefined) continue;
    if (k.trim() === name) return rest.join('=').trim();
  }
  return null;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // GET /auth/google — kick off OAuth flow
  app.get(
    '/auth/google',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (_request, reply) => {
      const state = generateState();
      const codeVerifier = generateCodeVerifier();

      const url = googleOAuth.createAuthorizationURL(state, codeVerifier, [...GOOGLE_SCOPES]);
      // Request offline access so we get a refresh token for long-lived Gmail/Calendar calls
      url.searchParams.set('access_type', 'offline');
      // Force consent screen every login so refresh token is always issued
      url.searchParams.set('prompt', 'consent');

      log.info('Initiating Google OAuth flow');

      return reply
        .header('Set-Cookie', oauthCookie(OAUTH_STATE_COOKIE, state))
        .header('Set-Cookie', oauthCookie(OAUTH_VERIFIER_COOKIE, codeVerifier))
        .redirect(url.toString());
    },
  );

  // GET /auth/google/callback — exchange code, find/create user, set session
  app.get(
    '/auth/google/callback',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { code, state } = request.query as { code?: string; state?: string };
      const cookieHeader = request.headers.cookie;

      const storedState = parseCookie(cookieHeader, OAUTH_STATE_COOKIE);
      const codeVerifier = parseCookie(cookieHeader, OAUTH_VERIFIER_COOKIE);

      // Clear oauth dance cookies regardless of outcome
      for (const c of clearOAuthCookies()) {
        reply.header('Set-Cookie', c);
      }

      if (!code || !state || !storedState || !codeVerifier || state !== storedState) {
        log.warn('OAuth callback state mismatch or missing params');
        return reply.redirect(`${FRONTEND_ORIGIN}?error=auth_failed`);
      }

      try {
        const tokens = await googleOAuth.validateAuthorizationCode(code, codeVerifier);
        const accessToken = tokens.accessToken();
        const refreshToken = tokens.hasRefreshToken() ? tokens.refreshToken() : null;
        const accessTokenExpiresAt = tokens.accessTokenExpiresAt();
        const googleUser = await fetchGoogleUser(accessToken);

        // Token fields to persist on every login (access token is always fresh; refresh only present on first consent)
        // Tokens are encrypted at rest using AES-256-GCM before storage.
        const tokenUpdate = {
          googleAccessToken: encryptNullable(accessToken),
          googleTokenExpiresAt: accessTokenExpiresAt,
          googleScopes: [...GOOGLE_SCOPES].join(' '),
          ...(refreshToken ? { googleRefreshToken: encryptNullable(refreshToken) } : {}),
        };

        // Find existing user by googleId, fall back to email match (for the seeded demo user)
        let userRow = (
          await db.select().from(users).where(eq(users.googleId, googleUser.sub)).limit(1)
        )[0];

        if (!userRow) {
          // Check if a user exists with this email (e.g. seeded demo user without a googleId)
          const byEmail = (
            await db.select().from(users).where(eq(users.email, googleUser.email)).limit(1)
          )[0];

          if (byEmail) {
            // Link the Google account to the existing user + store tokens
            const now = new Date();
            await db
              .update(users)
              .set({ googleId: googleUser.sub, updatedAt: now, ...tokenUpdate })
              .where(eq(users.id, byEmail.id));
            userRow = { ...byEmail, googleId: googleUser.sub, updatedAt: now, ...tokenUpdate };
            log.info({ userId: byEmail.id }, 'Linked Google account to existing user');
          } else {
            // First-time login: create a new user
            const newUser = (
              await db
                .insert(users)
                .values({
                  googleId: googleUser.sub,
                  name: googleUser.name,
                  email: googleUser.email,
                  preferences: { communicationTone: 'direct', riskTolerance: 'moderate', detailLevel: 'detailed' },
                  connectedServices: [],
                  ...tokenUpdate,
                })
                .returning()
            )[0];

            if (!newUser) throw new Error('Failed to create user');
            userRow = newUser;
            log.info({ userId: newUser.id }, 'New user created via Google OAuth');
          }
        } else {
          // Returning user — refresh the access token (and refresh token if newly issued)
          const now = new Date();
          await db
            .update(users)
            .set({ updatedAt: now, ...tokenUpdate })
            .where(eq(users.id, userRow.id));
          userRow = { ...userRow, updatedAt: now, ...tokenUpdate };
          log.info({ userId: userRow.id }, 'Refreshed Google tokens for returning user');
        }

        const sessionToken = await createSession(userRow.id);

        await writeAuditLog({
          userId: userRow.id,
          eventType: 'auth.login',
          entityType: 'session',
          metadata: { provider: 'google', email: googleUser.email },
          ipAddress: request.ip,
        });

        return reply
          .header('Set-Cookie', buildSessionCookie(sessionToken))
          .redirect(FRONTEND_ORIGIN);
      } catch (e) {
        log.error({ err: e }, 'OAuth callback error');
        return reply.redirect(`${FRONTEND_ORIGIN}?error=auth_failed`);
      }
    },
  );

  // POST /auth/logout — invalidate session and clear cookie
  app.post('/auth/logout', async (request, reply) => {
    const token = parseSessionToken(request.headers.cookie);
    if (token) {
      const sessionUser = await validateSession(token);
      await invalidateSession(token);
      await writeAuditLog({
        userId: sessionUser?.id ?? null,
        eventType: 'auth.logout',
        entityType: 'session',
        ipAddress: request.ip,
      });
    }
    return reply
      .header('Set-Cookie', buildClearCookie())
      .send({ ok: true });
  });

  // GET /auth/me — return current user for frontend auth check
  app.get('/auth/me', async (request, reply) => {
    const token = parseSessionToken(request.headers.cookie);
    if (!token) {
      return reply.status(401).send({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'Not logged in' } });
    }

    const sessionUser = await validateSession(token);
    if (!sessionUser) {
      return reply
        .header('Set-Cookie', buildClearCookie())
        .status(401)
        .send({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'Session expired' } });
    }

    // Refresh the cookie max-age if the session was refreshed
    reply.header('Set-Cookie', buildSessionCookie(token));
    return reply.send({
      ok: true,
      data: {
        id: sessionUser.id,
        name: sessionUser.name,
        email: sessionUser.email,
      },
    });
  });
}

// Re-export the session cookie name so middleware can use it
export { SESSION_COOKIE_NAME };
