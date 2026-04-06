import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  vector,
} from 'drizzle-orm/pg-core';

// ── Enums ──────────────────────────────────────────────────

export const workflowStatusEnum = pgEnum('workflow_status', [
  'active',
  'paused',
  'awaiting_user',
  'completed',
  'failed',
  'cancelled',
]);

export const taskStatusEnum = pgEnum('task_status', [
  'pending',
  'running',
  'awaiting_user',
  'awaiting_recovery',
  'completed',
  'failed',
  'skipped',
]);

export const agentNameEnum = pgEnum('agent_name', [
  'conductor',
  'research',
  'document',
  'comms',
  'decision',
  'finance',
]);

// ── Tables ─────────────────────────────────────────────────

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  googleId: text('google_id').unique(), // null for seed/test users; set on first Google OAuth login
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  // location: { zip, city, state, country }
  location: jsonb('location'),
  // preferences: { communicationTone, riskTolerance, detailLevel }
  preferences: jsonb('preferences').notNull().default({}),
  // connectedServices: [{ service, connectedAt, scopes[] }] — populated in Phase 4
  connectedServices: jsonb('connected_services').notNull().default([]),
  // Google OAuth tokens — stored after first Gmail/Calendar-scoped login
  googleAccessToken: text('google_access_token'),
  googleRefreshToken: text('google_refresh_token'),
  googleTokenExpiresAt: timestamp('google_token_expires_at', { withTimezone: true }),
  googleScopes: text('google_scopes'), // space-separated list of granted scopes
  // Stripe billing — populated on first checkout session creation
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  subscriptionStatus: text('subscription_status'), // active | trialing | past_due | canceled | incomplete | null
  // Plaid financial data — populated after user completes Plaid Link flow
  plaidAccessToken: text('plaid_access_token'), // encrypted at rest
  plaidItemId: text('plaid_item_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Session tokens — created on Google OAuth login, invalidated on logout.
// id is a random base64url token (not a UUID) stored in the session cookie.
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workflows = pgTable('workflows', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  templateId: text('template_id'),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  status: workflowStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const tasks = pgTable('tasks', {
  id: text('id').primaryKey(), // string ID from Conductor's task graph (e.g. "step_1")
  workflowId: uuid('workflow_id')
    .notNull()
    .references(() => workflows.id),
  agent: agentNameEnum('agent').notNull(),
  action: text('action').notNull(),
  inputs: jsonb('inputs').notNull().default({}),
  dependsOn: text('depends_on').array().notNull().default([]),
  autonomy: integer('autonomy').notNull().default(1), // AutonomyLevel 1/2/3
  status: taskStatusEnum('status').notNull().default('pending'),
  result: jsonb('result'),
  error: text('error'),
  recoveryFor: text('recovery_for'), // task ID this task is unblocking (if recovery task)
  recoveryAttempts: integer('recovery_attempts').notNull().default(0),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  contentText: text('content_text').notNull().default(''),
  // 1536 dimensions — matches text-embedding-3-small and Claude's embedding output
  embedding: vector('embedding', { dimensions: 1536 }),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const waitlistSignups = pgTable('waitlist_signups', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name'),
  referralSource: text('referral_source'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  // nullable: audit logs outlive users (set null on deletion, not cascade delete)
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  eventType: text('event_type').notNull(), // 'auth.login' | 'auth.logout' | 'task.approved' | etc.
  entityType: text('entity_type'),         // 'task' | 'document' | 'session'
  entityId: text('entity_id'),             // ID of the affected entity
  metadata: jsonb('metadata').notNull().default({}),
  ipAddress: text('ip_address'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // No updatedAt — audit logs are immutable append-only records
});

// ── Type exports ───────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Workflow = typeof workflows.$inferSelect;
export type NewWorkflow = typeof workflows.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
export type WaitlistSignup = typeof waitlistSignups.$inferSelect;
export type NewWaitlistSignup = typeof waitlistSignups.$inferInsert;
