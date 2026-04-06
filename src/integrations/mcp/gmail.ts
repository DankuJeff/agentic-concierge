/**
 * Gmail integration — send emails on behalf of the authenticated user.
 *
 * Uses the Gmail REST API directly (no SDK dependency).
 * Emails are RFC 2822 formatted, base64url encoded, then POSTed to the
 * messages.send endpoint with the user's access token.
 */

import { getValidToken } from '../google/tokens.js';
import { childLogger } from '../../shared/logger.js';

const log = childLogger({ module: 'integrations/mcp/gmail' });

export interface SendEmailParams {
  userId: string;
  to: string;
  subject: string;
  body: string;
  /** 'plain' (default) or 'html' */
  contentType?: 'plain' | 'html';
}

export type SendEmailResult =
  | { ok: true; messageId: string; threadId: string }
  | { ok: false; error: string };

/**
 * Sends an email via the Gmail API on behalf of the authenticated user.
 * Returns the Gmail message ID and thread ID on success.
 */
export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const { userId, to, subject, body, contentType = 'plain' } = params;

  const accessToken = await getValidToken(userId);
  if (!accessToken) {
    return { ok: false, error: 'Gmail not connected — user must re-authenticate with Gmail scopes' };
  }

  // Build RFC 2822 email
  const mime = buildMimeMessage({ to, subject, body, contentType });
  // Gmail API requires base64url encoding (no padding, - instead of +, _ instead of /)
  const encoded = Buffer.from(mime).toString('base64url');

  log.info({ userId, to, subject }, 'Sending email via Gmail API');

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: encoded }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    log.error({ userId, to, status: res.status, errBody }, 'Gmail send failed');
    return { ok: false, error: `Gmail API error ${res.status}: ${errBody}` };
  }

  const data = (await res.json()) as { id: string; threadId: string };
  log.info({ userId, to, messageId: data.id }, 'Email sent successfully');
  return { ok: true, messageId: data.id, threadId: data.threadId };
}

/** List recent emails matching a query (for research/context tasks). */
export async function listEmails(params: {
  userId: string;
  query?: string;
  maxResults?: number;
}): Promise<{ ok: true; messages: GmailMessageSummary[] } | { ok: false; error: string }> {
  const { userId, query = '', maxResults = 10 } = params;

  const accessToken = await getValidToken(userId);
  if (!accessToken) {
    return { ok: false, error: 'Gmail not connected' };
  }

  const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
  if (query) url.searchParams.set('q', query);
  url.searchParams.set('maxResults', String(maxResults));

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const errBody = await res.text();
    return { ok: false, error: `Gmail API error ${res.status}: ${errBody}` };
  }

  const data = (await res.json()) as { messages?: Array<{ id: string; threadId: string }> };
  const messages: GmailMessageSummary[] = (data.messages ?? []).map((m) => ({
    id: m.id,
    threadId: m.threadId,
  }));

  return { ok: true, messages };
}

export interface GmailMessageSummary {
  id: string;
  threadId: string;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function buildMimeMessage(opts: {
  to: string;
  subject: string;
  body: string;
  contentType: 'plain' | 'html';
}): string {
  const lines = [
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/${opts.contentType}; charset="UTF-8"`,
    `Content-Transfer-Encoding: 7bit`,
    '',
    opts.body,
  ];
  return lines.join('\r\n');
}
