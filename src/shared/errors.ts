import type { AppError } from './types.js';

export function makeError(
  code: string,
  message: string,
  retryable = false,
  details?: Record<string, unknown>,
): AppError {
  return { code, message, retryable, details };
}

// ── Pre-built error constants ──────────────────────────────

export const Errors = {
  AGENT_FAILED: (agentName: string, reason: string) =>
    makeError('AGENT_FAILED', `Agent '${agentName}' failed: ${reason}`, true),

  MAX_RECOVERY_EXCEEDED: (taskId: string) =>
    makeError(
      'MAX_RECOVERY_EXCEEDED',
      `Task '${taskId}' exceeded max recovery attempts (2). Escalating to user.`,
      false,
    ),

  INVALID_TASK_GRAPH: (reason: string) =>
    makeError('INVALID_TASK_GRAPH', `Conductor produced an invalid task graph: ${reason}`, true),

  DB_ERROR: (reason: string) =>
    makeError('DB_ERROR', `Database error: ${reason}`, true),

  ANTHROPIC_ERROR: (reason: string) =>
    makeError('ANTHROPIC_ERROR', `Anthropic API error: ${reason}`, true),

  WORKFLOW_NOT_FOUND: (workflowId: string) =>
    makeError('WORKFLOW_NOT_FOUND', `Workflow '${workflowId}' not found`, false),

  USER_NOT_FOUND: () =>
    makeError('USER_NOT_FOUND', 'No user found in the database. Run npm run db:seed first.', false),

  VALIDATION_ERROR: (reason: string) =>
    makeError('VALIDATION_ERROR', `Validation failed: ${reason}`, false),
} as const;
