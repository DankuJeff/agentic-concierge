/**
 * Task approval queue routes.
 *
 * GET  /tasks/pending-approval   — awaiting_user tasks for the authenticated user
 * POST /tasks/:id/approve        — approve a paused task and re-enqueue it
 * POST /tasks/:id/reject         — reject a paused task and fail the workflow
 *
 * All queries are scoped to the authenticated user via the workflow.userId FK.
 */

import type { FastifyInstance } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { db, tasks, workflows } from '../../db/index.js';
import { enqueueTask } from '../../conductor/dag-executor.js';
import { emitTaskStatus } from '../../shared/workflow-events.js';
import { childLogger } from '../../shared/logger.js';
import { sendEmail } from '../../integrations/mcp/gmail.js';
import { hasGoogleIntegration } from '../../integrations/google/tokens.js';
import { writeAuditLog } from '../../shared/audit.js';

const log = childLogger({ module: 'routes/tasks' });

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  // GET /tasks/pending-approval — approval queue poll endpoint
  app.get('/tasks/pending-approval', async (request, reply) => {
    const userId = request.user.id;

    const rows = await db
      .select({
        id: tasks.id,
        workflowId: tasks.workflowId,
        agent: tasks.agent,
        action: tasks.action,
        inputs: tasks.inputs,
        autonomy: tasks.autonomy,
        status: tasks.status,
        createdAt: tasks.createdAt,
        updatedAt: tasks.updatedAt,
        workflowName: workflows.name,
        workflowStatus: workflows.status,
      })
      .from(tasks)
      .innerJoin(workflows, eq(tasks.workflowId, workflows.id))
      .where(and(eq(tasks.status, 'awaiting_user'), eq(workflows.userId, userId)));

    return reply.send({ ok: true, data: rows });
  });

  // POST /tasks/:id/approve — approve a paused task, re-enqueue for execution
  app.post('/tasks/:id/approve', async (request, reply) => {
    const { id: taskId } = request.params as { id: string };
    const userId = request.user.id;

    // Fetch task + verify ownership via workflow
    const rows = await db
      .select({ task: tasks, workflowUserId: workflows.userId })
      .from(tasks)
      .innerJoin(workflows, eq(tasks.workflowId, workflows.id))
      .where(eq(tasks.id, taskId))
      .limit(1);

    const row = rows[0];
    if (!row || row.workflowUserId !== userId) {
      return reply.status(404).send({
        ok: false,
        error: { code: 'TASK_NOT_FOUND', message: `Task '${taskId}' not found` },
      });
    }

    const task = row.task;
    if (task.status !== 'awaiting_user') {
      return reply.status(409).send({
        ok: false,
        error: {
          code: 'INVALID_STATUS',
          message: `Task '${taskId}' is not awaiting approval (current status: ${task.status})`,
        },
      });
    }

    log.info({ taskId, workflowId: task.workflowId }, 'Task approved — re-enqueueing');

    // If this is a comms task with ready_to_send emails, attempt to send them via Gmail
    // before re-enqueueing. This is fire-and-report: failures are logged but don't block
    // the task from progressing.
    const sendResults: Array<{ recipient: string; ok: boolean; error?: string }> = [];
    if (task.agent === 'comms') {
      const result = task.result as Record<string, unknown> | null;
      const communications = result?.['communications'] as Array<Record<string, unknown>> | undefined;
      const readyToSend = result?.['ready_to_send'] as boolean | undefined;

      if (readyToSend && Array.isArray(communications) && communications.length > 0) {
        const gmailStatus = await hasGoogleIntegration(userId);
        if (gmailStatus.gmail) {
          for (const comm of communications) {
            const type = comm['type'] as string | undefined;
            const recipient = comm['recipient'] as string | undefined;
            const subject = comm['subject'] as string | undefined;
            const body = comm['body'] as string | undefined;

            // Only auto-send email type comms (not phone_script or letter)
            if (type === 'email' && recipient && subject && body) {
              // Validate recipient looks like an email address before sending
              if (recipient.includes('@')) {
                const result = await sendEmail({ userId, to: recipient, subject, body });
                sendResults.push({ recipient, ok: result.ok, ...(!result.ok ? { error: result.error } : {}) });
                log.info({ taskId, recipient, ok: result.ok }, 'Email send attempt');
              } else {
                log.info({ taskId, recipient }, 'Skipping email send — recipient is not an email address (may be a role name)');
              }
            }
          }
        } else {
          log.info({ taskId }, 'Gmail not connected — skipping auto-send');
        }
      }
    }

    // Reset to pending so enqueueTask's status→running transition is clean
    const now = new Date();
    await db
      .update(tasks)
      .set({ status: 'pending', updatedAt: now })
      .where(eq(tasks.id, taskId));

    await enqueueTask(taskId, task.workflowId);

    await writeAuditLog({
      userId,
      eventType: 'task.approved',
      entityType: 'task',
      entityId: taskId,
      metadata: { workflowId: task.workflowId, agent: task.agent, action: task.action },
      ipAddress: request.ip,
    });

    return reply.send({
      ok: true,
      data: {
        taskId,
        workflowId: task.workflowId,
        ...(sendResults.length > 0 ? { emailsSent: sendResults } : {}),
      },
    });
  });

  // POST /tasks/:id/reject — reject a paused task, fail the workflow
  app.post('/tasks/:id/reject', async (request, reply) => {
    const { id: taskId } = request.params as { id: string };
    const userId = request.user.id;

    // Fetch task + verify ownership via workflow
    const rows = await db
      .select({ task: tasks, workflowUserId: workflows.userId })
      .from(tasks)
      .innerJoin(workflows, eq(tasks.workflowId, workflows.id))
      .where(eq(tasks.id, taskId))
      .limit(1);

    const row = rows[0];
    if (!row || row.workflowUserId !== userId) {
      return reply.status(404).send({
        ok: false,
        error: { code: 'TASK_NOT_FOUND', message: `Task '${taskId}' not found` },
      });
    }

    const task = row.task;
    if (task.status !== 'awaiting_user') {
      return reply.status(409).send({
        ok: false,
        error: {
          code: 'INVALID_STATUS',
          message: `Task '${taskId}' is not awaiting approval (current status: ${task.status})`,
        },
      });
    }

    log.info({ taskId, workflowId: task.workflowId }, 'Task rejected by user');

    await writeAuditLog({
      userId,
      eventType: 'task.rejected',
      entityType: 'task',
      entityId: taskId,
      metadata: { workflowId: task.workflowId, agent: task.agent, action: task.action },
      ipAddress: request.ip,
    });

    const now = new Date();

    await db
      .update(tasks)
      .set({
        status: 'failed',
        error: 'Rejected by user',
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(tasks.id, taskId));

    emitTaskStatus({
      workflowId: task.workflowId,
      taskId,
      agent: task.agent,
      status: 'failed',
      updatedAt: now.toISOString(),
    });

    // Fail the parent workflow
    await db
      .update(workflows)
      .set({ status: 'failed', updatedAt: now })
      .where(
        and(
          eq(workflows.id, task.workflowId),
          eq(workflows.status, 'active'),
        ),
      );

    return reply.send({ ok: true, data: { taskId, workflowId: task.workflowId } });
  });
}
