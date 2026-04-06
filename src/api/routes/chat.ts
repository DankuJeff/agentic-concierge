import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { handleUserMessage } from '../../conductor/conductor.js';
import { db, workflows, tasks } from '../../db/index.js';
import { childLogger } from '../../shared/logger.js';

const log = childLogger({ module: 'routes/chat' });

const ChatBodySchema = z.object({
  // Increased to 12000 to accommodate stitched clarification context (original request + Q&A rounds)
  message: z.string().min(1).max(12000),
});

export async function chatRoutes(app: FastifyInstance) {
  // POST /chat — main entry point: decompose + kick off workflow
  app.post('/chat', async (request, reply) => {
    const body = ChatBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: body.error.message },
      });
    }

    const userId = request.user.id;
    log.info({ messagePreview: body.data.message.slice(0, 100), userId }, 'POST /chat');

    const result = await handleUserMessage(body.data.message, userId);

    if (!result.ok) {
      return reply.status(500).send({
        ok: false,
        error: result.error,
      });
    }

    // Clarification needed — return the question, no workflow created yet
    if (result.data.type === 'clarification') {
      return reply.status(200).send({
        ok: true,
        data: {
          type: 'clarification',
          question: result.data.question,
        },
      });
    }

    // Plan ready — workflow created and executing
    return reply.status(201).send({
      ok: true,
      data: {
        type: 'plan',
        workflowId: result.data.workflowId,
        plan: result.data.plan,
      },
    });
  });

  // GET /workflows — list workflows for the authenticated user
  app.get('/workflows', async (request, reply) => {
    const userId = request.user.id;

    const rows = await db
      .select({
        id: workflows.id,
        name: workflows.name,
        status: workflows.status,
        createdAt: workflows.createdAt,
        updatedAt: workflows.updatedAt,
      })
      .from(workflows)
      .where(and(eq(workflows.userId, userId)))
      .orderBy(workflows.createdAt);

    return reply.send({ ok: true, data: rows });
  });

  // GET /workflows/:id — full workflow detail with all task steps
  app.get('/workflows/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user.id;

    const workflowRows = await db
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, id), eq(workflows.userId, userId)))
      .limit(1);

    const workflow = workflowRows[0];
    if (!workflow) {
      return reply.status(404).send({
        ok: false,
        error: { code: 'WORKFLOW_NOT_FOUND', message: `Workflow '${id}' not found` },
      });
    }

    const taskRows = await db
      .select()
      .from(tasks)
      .where(eq(tasks.workflowId, id))
      .orderBy(tasks.createdAt);

    return reply.send({
      ok: true,
      data: { ...workflow, tasks: taskRows },
    });
  });
}
