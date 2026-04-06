/**
 * In-process event emitter for real-time workflow/task status updates.
 *
 * dag-executor emits events here whenever a task status changes.
 * The SSE route (/workflows/:id/events) subscribes and forwards to clients.
 *
 * Phase 2: single-process in-memory emitter — sufficient for localhost prototype.
 * Phase 4 upgrade: replace with Redis pub/sub for multi-process / multi-instance support.
 */

import { EventEmitter } from 'events';

export interface TaskStatusEvent {
  workflowId: string;
  taskId: string;
  agent: string;
  status: string;
  updatedAt: string; // ISO 8601
}

class WorkflowEventEmitter extends EventEmitter {}

export const workflowEvents = new WorkflowEventEmitter();

/** Emit a task status change — called by dag-executor after every DB status update. */
export function emitTaskStatus(event: TaskStatusEvent): void {
  workflowEvents.emit('task-status', event);
}
