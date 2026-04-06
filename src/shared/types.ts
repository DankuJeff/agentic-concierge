/**
 * Agentic Concierge — Core Type Definitions
 * 
 * These types define the contracts between all system components.
 * Every agent, workflow, and API endpoint references these types.
 */

import { z } from 'zod';

// ── Result Pattern ─────────────────────────────────────────

export type Result<T, E = AppError> =
  | { ok: true; data: T }
  | { ok: false; error: E };

export function ok<T>(data: T): Result<T, never> {
  return { ok: true, data };
}

export function err<E = AppError>(error: E): Result<never, E> {
  return { ok: false, error };
}

// ── Errors ─────────────────────────────────────────────────

export interface AppError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  retryable: boolean;
}

// ── Autonomy Levels ────────────────────────────────────────

export enum AutonomyLevel {
  /** Read-only operations, no approval needed */
  AUTO = 1,
  /** Actions with external effects, user sees and approves */
  APPROVE = 2,
  /** Irreversible/financial actions, user reviews and confirms */
  CONFIRM = 3,
}

// ── Agent Types ────────────────────────────────────────────

export const AgentName = z.enum([
  'conductor',
  'research',
  'document',
  'comms',
  'decision',
  'finance',
]);
export type AgentName = z.infer<typeof AgentName>;

export const TaskStatus = z.enum([
  'pending',
  'running',
  'awaiting_user',
  'awaiting_recovery',  // blocked on internal recovery Research task (not user)
  'completed',
  'failed',
  'skipped',
]);
export type TaskStatus = z.infer<typeof TaskStatus>;

// ── Task Definition ────────────────────────────────────────

export const TaskStepSchema = z.object({
  id: z.string(),
  agent: AgentName,
  action: z.string(),
  inputs: z.record(z.unknown()),
  dependsOn: z.array(z.string()).default([]),
  autonomy: z.nativeEnum(AutonomyLevel).default(AutonomyLevel.AUTO),
  status: TaskStatus.default('pending'),
  result: z.unknown().optional(),
  error: z.string().optional(),
  recoveryFor: z.string().optional(), // if set, this task is unblocking the task with this ID
  recoveryAttempts: z.number().default(0), // Conductor increments; max 2 before escalating to user
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
});
export type TaskStep = z.infer<typeof TaskStepSchema>;

// ── Workflow ───────────────────────────────────────────────

export const WorkflowStatus = z.enum([
  'active',
  'paused',
  'awaiting_user',
  'completed',
  'failed',
  'cancelled',
]);
export type WorkflowStatus = z.infer<typeof WorkflowStatus>;

export const WorkflowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  templateId: z.string().optional(),
  name: z.string(),
  description: z.string(),
  status: WorkflowStatus,
  steps: z.array(TaskStepSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Workflow = z.infer<typeof WorkflowSchema>;

// ── Workflow Template ──────────────────────────────────────

export interface WorkflowTemplate {
  id: string;
  version: string;
  name: string;
  description: string;
  triggers: string[];
  requiredContext: string[];
  estimatedDuration: string;
  steps: Omit<TaskStep, 'status' | 'result' | 'error' | 'startedAt' | 'completedAt'>[];
}

// ── Agent Communication ────────────────────────────────────

export const AgentTaskInputSchema = z.object({
  taskId: z.string(),
  workflowId: z.string().uuid(),
  action: z.string(),
  inputs: z.record(z.unknown()),
  userContext: z.record(z.unknown()),
  constraints: z.record(z.unknown()).default({}),
  recoveryFor: z.string().optional(), // set by Conductor when this task is recovering a blocked task
});
export type AgentTaskInput = z.infer<typeof AgentTaskInputSchema>;

export const AgentTaskOutputSchema = z.object({
  taskId: z.string(),
  status: z.enum(['completed', 'failed', 'needs_input']),
  result: z.unknown().optional(),
  confidence: z.number().min(0).max(1).optional(),
  sources: z.array(z.object({
    url: z.string().optional(),
    title: z.string(),
    date: z.string().nullish(),
  })).default([]),
  needsInputReason: z.string().optional(),
  suggestedResolution: z.string().optional(), // hints to Conductor: who/what can unblock this
  error: z.string().optional(),
});
export type AgentTaskOutput = z.infer<typeof AgentTaskOutputSchema>;

// ── User Context ───────────────────────────────────────────

export const UserProfileSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  location: z.object({
    zip: z.string(),
    city: z.string(),
    state: z.string(),
    country: z.string().default('US'),
  }).optional(),
  preferences: z.object({
    communicationTone: z.enum(['formal', 'casual', 'direct', 'diplomatic']).default('direct'),
    riskTolerance: z.enum(['conservative', 'moderate', 'aggressive']).default('moderate'),
    detailLevel: z.enum(['summary', 'detailed', 'comprehensive']).default('detailed'),
  }).default({}),
  connectedServices: z.array(z.object({
    service: z.string(),
    connectedAt: z.string().datetime(),
    scopes: z.array(z.string()),
  })).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type UserProfile = z.infer<typeof UserProfileSchema>;

// ── API Types ──────────────────────────────────────────────

export const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  workflowId: z.string().uuid().optional(),
  approvalAction: z.object({
    taskId: z.string(),
    approved: z.boolean(),
    modifications: z.record(z.unknown()).optional(),
  }).optional(),
  timestamp: z.string().datetime(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
