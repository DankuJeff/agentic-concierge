/**
 * Google Calendar integration — create and list events on behalf of the user.
 *
 * Uses the Google Calendar REST API directly (no SDK dependency).
 * All operations target the user's primary calendar.
 */

import { getValidToken } from '../google/tokens.js';
import { childLogger } from '../../shared/logger.js';

const log = childLogger({ module: 'integrations/mcp/calendar' });

const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3/calendars/primary';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CalendarEventTime {
  /** ISO 8601 datetime string (e.g. "2026-04-15T10:00:00") */
  dateTime: string;
  /** IANA timezone (e.g. "America/Chicago"). Defaults to UTC if omitted. */
  timeZone?: string;
}

export interface CreateEventParams {
  userId: string;
  summary: string;
  description?: string;
  location?: string;
  start: CalendarEventTime;
  end: CalendarEventTime;
  /** Optional list of attendee email addresses */
  attendees?: string[];
}

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: CalendarEventTime;
  end: CalendarEventTime;
  htmlLink: string;
  status: string;
}

export interface ListEventsParams {
  userId: string;
  /** ISO 8601 datetime — only return events starting after this time (default: now) */
  timeMin?: string;
  /** ISO 8601 datetime — only return events starting before this time */
  timeMax?: string;
  maxResults?: number;
  /** Free-text search within event fields */
  query?: string;
}

// ── API calls ─────────────────────────────────────────────────────────────────

/**
 * Creates a new event on the user's primary Google Calendar.
 * Returns the created event on success.
 */
export async function createEvent(
  params: CreateEventParams,
): Promise<{ ok: true; event: CalendarEvent } | { ok: false; error: string }> {
  const accessToken = await getValidToken(params.userId);
  if (!accessToken) {
    return { ok: false, error: 'Google Calendar not connected — user must re-authenticate' };
  }

  const body: Record<string, unknown> = {
    summary: params.summary,
    start: params.start,
    end: params.end,
  };
  if (params.description) body['description'] = params.description;
  if (params.location) body['location'] = params.location;
  if (params.attendees?.length) {
    body['attendees'] = params.attendees.map((email) => ({ email }));
  }

  log.info({ userId: params.userId, summary: params.summary }, 'Creating Calendar event');

  const res = await fetch(`${CALENDAR_BASE}/events`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    log.error({ userId: params.userId, status: res.status, errBody }, 'Calendar createEvent failed');
    return { ok: false, error: `Calendar API error ${res.status}: ${errBody}` };
  }

  const data = (await res.json()) as CalendarEvent;
  log.info({ userId: params.userId, eventId: data.id }, 'Calendar event created');
  return { ok: true, event: data };
}

/**
 * Lists upcoming events from the user's primary Google Calendar.
 */
export async function listEvents(
  params: ListEventsParams,
): Promise<{ ok: true; events: CalendarEvent[] } | { ok: false; error: string }> {
  const accessToken = await getValidToken(params.userId);
  if (!accessToken) {
    return { ok: false, error: 'Google Calendar not connected' };
  }

  const url = new URL(`${CALENDAR_BASE}/events`);
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('orderBy', 'startTime');
  url.searchParams.set('timeMin', params.timeMin ?? new Date().toISOString());
  if (params.timeMax) url.searchParams.set('timeMax', params.timeMax);
  if (params.maxResults) url.searchParams.set('maxResults', String(params.maxResults));
  if (params.query) url.searchParams.set('q', params.query);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const errBody = await res.text();
    return { ok: false, error: `Calendar API error ${res.status}: ${errBody}` };
  }

  const data = (await res.json()) as { items?: CalendarEvent[] };
  return { ok: true, events: data.items ?? [] };
}
