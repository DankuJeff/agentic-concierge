/**
 * Audit logging — append-only record of sensitive user actions.
 *
 * Writes are best-effort: failures are caught and logged but never thrown,
 * so audit logging never blocks or fails the operation being audited.
 *
 * Event catalogue:
 *   auth.login         — user authenticated via Google OAuth
 *   auth.logout        — user signed out
 *   task.approved      — user approved a pending task from the approval queue
 *   task.rejected      — user rejected a pending task from the approval queue
 *   document.uploaded  — user uploaded a document to the vault
 *   workflow.feedback  — user submitted thumbs up/down on a completed workflow
 */

import { db, auditLogs } from '../db/index.js';
import { childLogger } from './logger.js';

const log = childLogger({ module: 'audit' });

export type AuditEventType =
  | 'auth.login'
  | 'auth.logout'
  | 'task.approved'
  | 'task.rejected'
  | 'document.uploaded'
  | 'workflow.feedback';

export interface AuditEvent {
  userId: string | null;
  eventType: AuditEventType;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

export async function writeAuditLog(event: AuditEvent): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      userId: event.userId ?? null,
      eventType: event.eventType,
      entityType: event.entityType ?? null,
      entityId: event.entityId ?? null,
      metadata: event.metadata ?? {},
      ipAddress: event.ipAddress ?? null,
    });
  } catch (e) {
    log.error({ event, err: e }, 'Failed to write audit log — non-fatal');
  }
}
