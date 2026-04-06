import { Queue, Worker, type Job } from 'bullmq';
import { eq, and, inArray, notInArray } from 'drizzle-orm';
import { db, workflows, tasks, users } from '../db/index.js';
import { AutonomyLevel, type AgentName, type TaskStep, type Result } from '../shared/types.js';
import { ok, err } from '../shared/types.js';
import { Errors } from '../shared/errors.js';
import { childLogger } from '../shared/logger.js';
import { getUser } from '../context/profile.js';
import { assembleContext } from '../context/assembler.js';
import { hasGoogleIntegration } from '../integrations/google/tokens.js';
import { getAccounts } from '../integrations/plaid/client.js';
import { decryptNullable } from '../shared/encryption.js';
import { ResearchAgent } from '../agents/research/agent.js';
import { FinanceAgent } from '../agents/finance/agent.js';
import { DecisionAgent } from '../agents/decision/agent.js';
import { CommsAgent } from '../agents/comms/agent.js';
import { DocumentAgent } from '../agents/document/agent.js';
import { emitTaskStatus } from '../shared/workflow-events.js';

const log = childLogger({ module: 'dag-executor' });

const QUEUE_NAME = 'concierge-tasks';

export const taskQueue = new Queue(QUEUE_NAME, {
  connection: { url: process.env['REDIS_URL'] ?? 'redis://localhost:6379' },
});

// ── Workflow creation ──────────────────────────────────────

export async function createWorkflow(
  userId: string,
  goal: string,
  steps: TaskStep[],
): Promise<Result<string>> {
  try {
    const workflowId = crypto.randomUUID();

    await db.transaction(async (tx) => {
      await tx.insert(workflows).values({
        id: workflowId,
        userId,
        name: goal.slice(0, 200),
        description: goal,
        status: 'active',
      });

      if (steps.length > 0) {
        await tx.insert(tasks).values(
          steps.map((step) => ({
            id: `${workflowId}:${step.id}`,
            workflowId,
            agent: step.agent,
            action: step.action,
            inputs: step.inputs,
            dependsOn: step.dependsOn.map((depId) => `${workflowId}:${depId}`),
            autonomy: step.autonomy,
            status: 'pending' as const,
            recoveryAttempts: 0,
          })),
        );
      }
    });

    log.info({ workflowId, stepCount: steps.length }, 'Workflow created in DB');
    return ok(workflowId);
  } catch (e) {
    return err(Errors.DB_ERROR(e instanceof Error ? e.message : String(e)));
  }
}

// ── Execution ──────────────────────────────────────────────

export async function executeWorkflow(workflowId: string): Promise<void> {
  const readyTasks = await getReadyTasks(workflowId);
  for (const task of readyTasks) {
    await enqueueTask(task.id, workflowId);
  }
}

async function getReadyTasks(workflowId: string) {
  // Fetch ALL tasks for the workflow — need completed tasks to resolve dependencies
  const allTasks = await db
    .select()
    .from(tasks)
    .where(eq(tasks.workflowId, workflowId));

  const completedIds = new Set(
    allTasks.filter((t) => t.status === 'completed').map((t) => t.id),
  );

  // A task is ready if it's pending and all its dependencies are completed
  return allTasks.filter(
    (t) =>
      t.status === 'pending' &&
      (t.dependsOn as string[]).every((depId) => completedIds.has(depId)),
  );
}

export async function enqueueTask(taskId: string, workflowId: string) {
  const now = new Date();
  await db
    .update(tasks)
    .set({ status: 'running', startedAt: now, updatedAt: now })
    .where(eq(tasks.id, taskId));

  // Fetch agent name for the event
  const rows = await db.select({ agent: tasks.agent }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
  emitTaskStatus({ workflowId, taskId, agent: rows[0]?.agent ?? 'unknown', status: 'running', updatedAt: now.toISOString() });

  // jobId = taskId makes this call idempotent: BullMQ silently skips if a job
  // with this ID is already waiting or active. Safe for the resume path.
  // attempts: 4 total tries with exponential backoff for transient API errors (529, 429).
  await taskQueue.add(
    'execute-task',
    { taskId, workflowId },
    {
      jobId: taskId.replace(/:/g, '_'),
      attempts: 4,
      backoff: { type: 'exponential', delay: 15_000 }, // 15s, 30s, 60s
    },
  );
  log.info({ taskId, workflowId }, 'Task enqueued');
}

// ── Startup resumption ────────────────────────────────────

/**
 * On server restart, re-enqueue any tasks from active workflows that were
 * interrupted or never started:
 *   - 'running' tasks: the server crashed mid-execution — reset to 'pending' and re-enqueue.
 *   - 'pending' tasks with all deps completed: ready but never dispatched (e.g. crash between
 *     workflow creation and initial dispatch).
 *
 * Called once in server.ts after startWorker(). The enqueueTask jobId option ensures
 * this is idempotent — BullMQ silently skips jobs that are already waiting/active.
 */
export async function resumeActiveWorkflows(): Promise<void> {
  const activeWorkflows = await db
    .select({ id: workflows.id })
    .from(workflows)
    .where(notInArray(workflows.status, ['completed', 'failed', 'cancelled', 'paused']));

  if (activeWorkflows.length === 0) {
    log.info('resumeActiveWorkflows: no active workflows found');
    return;
  }

  log.info({ count: activeWorkflows.length }, 'resumeActiveWorkflows: scanning workflows');

  for (const wf of activeWorkflows) {
    const workflowId = wf.id;
    const allTasks = await db
      .select()
      .from(tasks)
      .where(eq(tasks.workflowId, workflowId));

    if (allTasks.length === 0) continue;

    const completedIds = new Set(
      allTasks.filter((t) => t.status === 'completed').map((t) => t.id),
    );

    // Tasks that were running when the server crashed — treat as interrupted
    const interruptedTasks = allTasks.filter((t) => t.status === 'running');
    if (interruptedTasks.length > 0) {
      const now = new Date();
      await db
        .update(tasks)
        .set({ status: 'pending', updatedAt: now })
        .where(inArray(tasks.id, interruptedTasks.map((t) => t.id)));
      log.info(
        { workflowId, taskIds: interruptedTasks.map((t) => t.id) },
        'resumeActiveWorkflows: reset interrupted tasks to pending',
      );
    }

    // Tasks ready to run: pending (including just-reset ones) with all deps completed.
    // Use the in-memory snapshot for dep check — interrupted tasks' deps were already
    // satisfied when they first ran, so they will pass this filter after the reset above.
    const toResume = allTasks.filter(
      (t) =>
        (t.status === 'pending' || (t.status === 'running' && interruptedTasks.some((i) => i.id === t.id))) &&
        (t.dependsOn as string[]).every((depId) => completedIds.has(depId)),
    );

    for (const task of toResume) {
      log.info({ workflowId, taskId: task.id }, 'resumeActiveWorkflows: re-enqueuing task');
      await enqueueTask(task.id, workflowId);
    }
  }
}

// ── $step_N.result reference resolution ───────────────────

/**
 * Resolves "$step_N.result.field" references in a task's inputs.
 * Called before passing inputs to a specialist agent.
 */
export async function resolveInputRefs(
  inputs: Record<string, unknown>,
  workflowId: string,
): Promise<Record<string, unknown>> {
  const resolved: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(inputs)) {
    if (typeof value === 'string' && value.startsWith('$')) {
      // e.g. "$step_1.result.providers" → taskId="workflowId:step_1", path=["result","providers"]
      const refPath = value.slice(1).split('.');
      const stepId = refPath[0];
      const fieldPath = refPath.slice(1); // ["result", "providers"]

      const taskId = `${workflowId}:${stepId}`;
      const rows = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
      const task = rows[0];

      if (!task || task.status !== 'completed') {
        log.warn({ taskId, refPath: value }, 'Referenced task not yet completed — using null');
        resolved[key] = null;
      } else {
        // Walk the field path
        let current: unknown = task;
        for (const segment of fieldPath) {
          current = (current as Record<string, unknown>)[segment];
        }
        resolved[key] = current;
      }
    } else {
      resolved[key] = value;
    }
  }

  return resolved;
}

// ── Workflow status reconciliation ────────────────────────

/**
 * After any task reaches a terminal state, re-evaluate the workflow status:
 *   - Any task failed            → workflow = 'failed'
 *   - All tasks completed/skipped → workflow = 'completed'
 *   - Any task awaiting_user, none running/pending → workflow = 'awaiting_user'
 *   - Otherwise                  → leave as 'active'
 */
async function reconcileWorkflowStatus(workflowId: string): Promise<void> {
  const allTasks = await db
    .select({ status: tasks.status })
    .from(tasks)
    .where(eq(tasks.workflowId, workflowId));

  if (allTasks.length === 0) return;

  const statuses = allTasks.map((t) => t.status);

  let newStatus: 'active' | 'awaiting_user' | 'completed' | 'failed' | null = null;

  if (statuses.some((s) => s === 'failed' || s === 'awaiting_recovery')) {
    newStatus = 'failed';
  } else if (statuses.every((s) => s === 'completed' || s === 'skipped')) {
    newStatus = 'completed';
  } else if (
    statuses.some((s) => s === 'awaiting_user') &&
    !statuses.some((s) => s === 'running' || s === 'pending')
  ) {
    newStatus = 'awaiting_user';
  }

  if (!newStatus) return;

  const now = new Date();
  await db
    .update(workflows)
    .set({ status: newStatus, updatedAt: now })
    .where(
      and(
        eq(workflows.id, workflowId),
        // Don't overwrite an already-terminal status (e.g. cancelled)
        inArray(workflows.status, ['active', 'awaiting_user']),
      ),
    );

  log.info({ workflowId, newStatus }, 'Workflow status reconciled');
}

// ── Worker ─────────────────────────────────────────────────

export function startWorker() {
  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job<{ taskId: string; workflowId: string }>) => {
      const { taskId, workflowId } = job.data;
      log.info({ taskId, workflowId }, 'Worker processing task');

      const rows = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
      const task = rows[0];
      if (!task) {
        log.error({ taskId }, 'Task not found in DB');
        return;
      }

      // Pause on Level 2/3 actions — requires user approval before execution
      if (task.autonomy >= AutonomyLevel.APPROVE) {
        const pausedAt = new Date();
        await db
          .update(tasks)
          .set({ status: 'awaiting_user', updatedAt: pausedAt })
          .where(eq(tasks.id, taskId));
        emitTaskStatus({ workflowId, taskId, agent: task.agent, status: 'awaiting_user', updatedAt: pausedAt.toISOString() });
        log.info({ taskId, autonomy: task.autonomy }, 'Task paused for user approval');
        await reconcileWorkflowStatus(workflowId);
        return;
      }

      // Dispatch to the correct specialist agent
      try {
        // Load the workflow owner's profile for context assembly (multi-tenant)
        const workflowRows = await db.select({ userId: workflows.userId }).from(workflows).where(eq(workflows.id, workflowId)).limit(1);
        const workflowUserId = workflowRows[0]?.userId;
        const userResult = workflowUserId ? await getUser(workflowUserId) : { ok: false as const, error: 'no userId' };
        let userContext = userResult.ok
          ? assembleContext(userResult.data, task.agent as AgentName, task.inputs as Record<string, unknown>)
          : {};

        // Inject Gmail connection status for comms tasks so the agent knows emails can be sent
        if (task.agent === 'comms' && workflowUserId) {
          const gmailStatus = await hasGoogleIntegration(workflowUserId);
          userContext = { ...userContext, gmailConnected: gmailStatus.gmail };
        }

        // Inject Plaid account/balance data for finance tasks when the user has connected Plaid.
        // Gives the Finance Agent real balances instead of relying on user-provided estimates.
        if (task.agent === 'finance' && workflowUserId) {
          const userRows = await db
            .select({ plaidAccessToken: users.plaidAccessToken })
            .from(users)
            .where(eq(users.id, workflowUserId))
            .limit(1);
          const plaidToken = decryptNullable(userRows[0]?.plaidAccessToken);
          if (plaidToken) {
            try {
              const plaidAccounts = await getAccounts(plaidToken);
              userContext = { ...userContext, plaidConnected: true, plaidAccounts };
            } catch {
              // Token exists (user connected Plaid) but the live fetch failed.
              // Signal connected with empty accounts so the Finance Agent knows
              // the integration exists but data is temporarily unavailable —
              // distinct from plaidConnected: false which means never connected.
              log.warn({ workflowUserId }, 'Failed to fetch Plaid accounts for finance task — continuing without live data');
              userContext = { ...userContext, plaidConnected: true, plaidAccounts: [] };
            }
          } else {
            userContext = { ...userContext, plaidConnected: false };
          }
        }

        // Resolve any $step_N.result references in inputs before dispatching
        const resolvedInputs = await resolveInputRefs(
          task.inputs as Record<string, unknown>,
          workflowId,
        );

        const result = await dispatchToAgent(task.agent, {
          taskId,
          workflowId,
          action: task.action,
          inputs: resolvedInputs,
          userContext,
          constraints: {},
        });

        // Map AgentTaskOutput status → DB TaskStatus
        const dbStatus =
          result.status === 'completed' ? 'completed' :
          result.status === 'needs_input' ? 'awaiting_recovery' :
          'failed';

        const finishedAt = new Date();
        await db
          .update(tasks)
          .set({
            status: dbStatus,
            result: result.result as Record<string, unknown> | undefined,
            error: result.error ?? (result.status === 'needs_input' ? result.needsInputReason : undefined),
            completedAt: finishedAt,
            updatedAt: finishedAt,
          })
          .where(eq(tasks.id, taskId));
        emitTaskStatus({ workflowId, taskId, agent: task.agent, status: dbStatus, updatedAt: finishedAt.toISOString() });

        // If completed, enqueue newly-ready tasks, then reconcile workflow status
        if (result.status === 'completed') {
          await executeWorkflow(workflowId);
        }
        await reconcileWorkflowStatus(workflowId);
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        const isTransient = errMsg.includes('529') || errMsg.includes('overloaded') || errMsg.includes('rate_limit') || errMsg.includes('429');

        if (isTransient && (job.attemptsMade ?? 0) < (job.opts?.attempts ?? 1) - 1) {
          // Transient API error with retries remaining — reset task to running so
          // the next BullMQ attempt picks it up cleanly, then re-throw for BullMQ backoff.
          log.warn({ taskId, attempt: job.attemptsMade, err: errMsg }, 'Transient API error — will retry via BullMQ backoff');
          const now = new Date();
          await db.update(tasks).set({ status: 'running', updatedAt: now }).where(eq(tasks.id, taskId));
          throw e; // BullMQ catches this and schedules a retry
        }

        log.error({ taskId, err: e }, 'Worker task dispatch failed');
        const failedAt = new Date();
        await db
          .update(tasks)
          .set({
            status: 'failed',
            error: errMsg,
            completedAt: failedAt,
            updatedAt: failedAt,
          })
          .where(eq(tasks.id, taskId));
        emitTaskStatus({ workflowId, taskId, agent: task.agent, status: 'failed', updatedAt: failedAt.toISOString() });
        await reconcileWorkflowStatus(workflowId);
      }
    },
    {
      connection: { url: process.env['REDIS_URL'] ?? 'redis://localhost:6379' },
      concurrency: 2, // reduced from 5 — 3+ parallel research tasks hit 30K token/min rate limit
    },
  );

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'BullMQ job failed');
  });

  log.info('DAG executor worker started');
  return worker;
}

// ── Agent dispatch ─────────────────────────────────────────

import type { AgentTaskInput, AgentTaskOutput } from '../shared/types.js';

/**
 * Routes a task to the correct specialist agent and returns its output.
 * Add a new case here as each Phase 1+ agent is implemented.
 */
async function dispatchToAgent(
  agentName: string,
  task: AgentTaskInput,
): Promise<AgentTaskOutput> {
  log.info({ agentName, taskId: task.taskId, action: task.action }, 'Dispatching to agent');

  switch (agentName) {
    case 'research': {
      const agent = new ResearchAgent();
      return agent.run(task);
    }

    case 'finance': {
      const agent = new FinanceAgent();
      return agent.run(task);
    }

    case 'decision': {
      const agent = new DecisionAgent();
      return agent.run(task);
    }

    case 'comms': {
      const agent = new CommsAgent();
      return agent.run(task);
    }

    case 'document': {
      const agent = new DocumentAgent();
      return agent.run(task);
    }

    default:
      log.warn({ agentName, taskId: task.taskId }, 'Agent not yet implemented');
      return {
        taskId: task.taskId,
        status: 'needs_input',
        sources: [],
        needsInputReason: `Agent '${agentName}' is not yet implemented.`,
        suggestedResolution: 'user_input',
      };
  }
}
