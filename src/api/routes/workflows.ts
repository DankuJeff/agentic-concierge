/**
 * Workflow management routes.
 *
 * GET /workflows/:id/events — SSE stream of task status changes for a workflow.
 *   Streams events as they happen. Keeps connection alive with a 15-second ping.
 *   Client disconnects are cleaned up automatically.
 *   Ownership is verified before the stream is opened.
 */

import type { FastifyInstance } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { db, workflows } from '../../db/index.js';
import { workflowEvents, type TaskStatusEvent } from '../../shared/workflow-events.js';
import { childLogger } from '../../shared/logger.js';

const log = childLogger({ module: 'routes/workflows' });

export async function workflowRoutes(app: FastifyInstance): Promise<void> {
  // GET /workflows/:id/events — SSE stream
  app.get('/workflows/:id/events', async (request, reply) => {
    const { id: workflowId } = request.params as { id: string };
    const userId = request.user.id;

    // Verify the workflow belongs to this user before opening the stream
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

    log.info({ workflowId, userId }, 'SSE client connected');

    // Take over the raw socket — Fastify must not attempt to serialize the response
    reply.hijack();
    const res = reply.raw;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering if proxied
    res.flushHeaders();

    const send = (data: object) => {
      try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch {
        // Client already disconnected — listener cleanup handles the rest
      }
    };

    const listener = (event: TaskStatusEvent) => {
      if (event.workflowId === workflowId) {
        send(event);
      }
    };

    workflowEvents.on('task-status', listener);

    const ping = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        // Ignore — close handler will clean up
      }
    }, 15_000);

    request.raw.on('close', () => {
      log.info({ workflowId }, 'SSE client disconnected');
      clearInterval(ping);
      workflowEvents.off('task-status', listener);
    });

    await new Promise<void>((resolve) => {
      request.raw.on('close', resolve);
    });
  });
}
