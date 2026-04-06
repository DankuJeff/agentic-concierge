/**
 * Analytics routes.
 *
 * GET  /analytics/summary       — usage metrics for the authenticated user
 * POST /workflows/:id/feedback  — record thumbs up/down on a completed workflow
 */

import type { FastifyInstance } from 'fastify';
import { eq, and, gt, isNull, desc, sql } from 'drizzle-orm';
import { db, workflows, tasks, auditLogs } from '../../db/index.js';
import { writeAuditLog } from '../../shared/audit.js';
import { childLogger } from '../../shared/logger.js';

const log = childLogger({ module: 'routes/analytics' });

export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  // GET /analytics/summary
  app.get('/analytics/summary', async (request, reply) => {
    const userId = request.user.id;

    // 1. Workflow counts by status
    const workflowRows = await db
      .select({
        status: workflows.status,
        count: sql<number>`count(*)::int`,
      })
      .from(workflows)
      .where(and(eq(workflows.userId, userId), isNull(workflows.deletedAt)))
      .groupBy(workflows.status);

    const wfByStatus: Record<string, number> = {};
    for (const row of workflowRows) wfByStatus[row.status] = row.count;

    const wfTotal = Object.values(wfByStatus).reduce((s, c) => s + c, 0);
    const wfCompleted = wfByStatus['completed'] ?? 0;
    const wfFailed = wfByStatus['failed'] ?? 0;
    const wfCancelled = wfByStatus['cancelled'] ?? 0;
    const wfActive = wfTotal - wfCompleted - wfFailed - wfCancelled;
    const wfCompletionRate =
      wfCompleted + wfFailed > 0 ? wfCompleted / (wfCompleted + wfFailed) : null;

    // 2. Average duration of completed workflows
    const [durationRow] = await db
      .select({
        avgMs: sql<string | null>`avg(extract(epoch from (updated_at - created_at)) * 1000)`,
      })
      .from(workflows)
      .where(
        and(
          eq(workflows.userId, userId),
          eq(workflows.status, 'completed'),
          isNull(workflows.deletedAt),
        ),
      );

    const avgWorkflowDurationMs =
      durationRow?.avgMs != null ? Math.round(parseFloat(durationRow.avgMs)) : null;

    // 3. Task counts by status + agent
    const taskRows = await db
      .select({
        status: tasks.status,
        agent: tasks.agent,
        count: sql<number>`count(*)::int`,
      })
      .from(tasks)
      .innerJoin(workflows, eq(tasks.workflowId, workflows.id))
      .where(and(eq(workflows.userId, userId), isNull(workflows.deletedAt)))
      .groupBy(tasks.status, tasks.agent);

    let taskTotal = 0;
    let taskCompleted = 0;
    let taskFailed = 0;
    const byAgent: Record<string, { total: number; completed: number; failed: number }> = {};

    for (const row of taskRows) {
      taskTotal += row.count;
      if (row.status === 'completed') taskCompleted += row.count;
      if (row.status === 'failed') taskFailed += row.count;

      if (!byAgent[row.agent]) byAgent[row.agent] = { total: 0, completed: 0, failed: 0 };
      byAgent[row.agent]!.total += row.count;
      if (row.status === 'completed') byAgent[row.agent]!.completed += row.count;
      if (row.status === 'failed') byAgent[row.agent]!.failed += row.count;
    }

    const taskCompletionRate =
      taskCompleted + taskFailed > 0 ? taskCompleted / (taskCompleted + taskFailed) : null;

    // 4. Tasks that needed at least one recovery attempt
    const [recoveryRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tasks)
      .innerJoin(workflows, eq(tasks.workflowId, workflows.id))
      .where(and(eq(workflows.userId, userId), gt(tasks.recoveryAttempts, 0)));

    const recoveredTasks = recoveryRow?.count ?? 0;

    // 5. Satisfaction scores from audit_logs
    const feedbackRows = await db
      .select({ metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(and(eq(auditLogs.userId, userId), eq(auditLogs.eventType, 'workflow.feedback')));

    let positive = 0;
    let negative = 0;
    for (const row of feedbackRows) {
      const meta = row.metadata as Record<string, unknown>;
      if (meta['rating'] === 'positive') positive++;
      if (meta['rating'] === 'negative') negative++;
    }
    const satisfactionTotal = positive + negative;
    const satisfactionScore = satisfactionTotal > 0 ? positive / satisfactionTotal : null;

    // 6. Recent workflows (last 10)
    const recentWorkflows = await db
      .select({
        id: workflows.id,
        name: workflows.name,
        status: workflows.status,
        createdAt: workflows.createdAt,
        updatedAt: workflows.updatedAt,
      })
      .from(workflows)
      .where(and(eq(workflows.userId, userId), isNull(workflows.deletedAt)))
      .orderBy(desc(workflows.createdAt))
      .limit(10);

    log.info({ userId, wfTotal, taskTotal }, 'Analytics summary fetched');

    return reply.send({
      ok: true,
      data: {
        workflows: {
          total: wfTotal,
          completed: wfCompleted,
          failed: wfFailed,
          active: Math.max(0, wfActive),
          completionRate: wfCompletionRate,
        },
        tasks: {
          total: taskTotal,
          completed: taskCompleted,
          failed: taskFailed,
          completionRate: taskCompletionRate,
          byAgent,
        },
        performance: {
          avgWorkflowDurationMs,
          recoveredTasks,
        },
        satisfaction: {
          total: satisfactionTotal,
          positive,
          negative,
          score: satisfactionScore,
        },
        recentWorkflows,
      },
    });
  });

  // POST /workflows/:id/feedback — thumbs up/down on a completed workflow
  app.post('/workflows/:id/feedback', async (request, reply) => {
    const { id: workflowId } = request.params as { id: string };
    const userId = request.user.id;
    const body = request.body as { rating?: unknown; note?: unknown };

    if (body.rating !== 'positive' && body.rating !== 'negative') {
      return reply.status(400).send({
        ok: false,
        error: { code: 'INVALID_RATING', message: "rating must be 'positive' or 'negative'" },
      });
    }

    // Verify ownership
    const rows = await db
      .select({ id: workflows.id })
      .from(workflows)
      .where(and(eq(workflows.id, workflowId), eq(workflows.userId, userId)))
      .limit(1);

    if (!rows[0]) {
      return reply.status(404).send({
        ok: false,
        error: { code: 'WORKFLOW_NOT_FOUND', message: `Workflow '${workflowId}' not found` },
      });
    }

    await writeAuditLog({
      userId,
      eventType: 'workflow.feedback',
      entityType: 'workflow',
      entityId: workflowId,
      metadata: {
        rating: body.rating,
        ...(typeof body.note === 'string' && body.note ? { note: body.note } : {}),
      },
      ipAddress: request.ip,
    });

    return reply.send({ ok: true });
  });
}
