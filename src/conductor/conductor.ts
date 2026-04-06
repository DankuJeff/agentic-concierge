import { type TaskStep, type Result } from '../shared/types.js';
import { ok, err } from '../shared/types.js';
import { getUser } from '../context/profile.js';
import { assembleContext } from '../context/assembler.js';
import { decompose } from './decomposer.js';
import { createWorkflow, executeWorkflow } from './dag-executor.js';
import { childLogger } from '../shared/logger.js';

const log = childLogger({ module: 'conductor' });

export type ConductorResult =
  | { type: 'plan'; workflowId: string; plan: TaskStep[] }
  | { type: 'clarification'; question: string };

/**
 * Main entry point for all user messages.
 *
 * Returns either:
 *   - { type: 'plan', workflowId, plan } — workflow created and executing
 *   - { type: 'clarification', question } — more context needed; no workflow created
 *
 * The chat route handles both cases. The frontend stitches clarification Q&A rounds
 * into an enriched message and retries until the Conductor has enough context.
 */
export async function handleUserMessage(
  message: string,
  userId: string,
): Promise<Result<ConductorResult>> {
  log.info({ messagePreview: message.slice(0, 100), userId }, 'Handling user message');

  // 1. Load user profile by ID (from the authenticated session)
  const userResult = await getUser(userId);
  if (!userResult.ok) {
    log.error({ error: userResult.error, userId }, 'Failed to load user profile');
    return err(userResult.error);
  }
  const user = userResult.data;

  // 2. Assemble conductor context (full profile for routing decisions)
  const conductorContext = assembleContext(user, 'conductor', {});

  // 3. Decompose — returns a plan or a clarification question
  const decomposeResult = await decompose(message, conductorContext);
  if (!decomposeResult.ok) {
    log.error({ error: decomposeResult.error }, 'Task decomposition failed');
    return err(decomposeResult.error);
  }

  const output = decomposeResult.data;

  // 4a. Clarification needed — return question without creating a workflow
  if (output.type === 'clarification') {
    log.info({ question: output.question.slice(0, 100) }, 'Conductor requesting clarification');
    return ok({ type: 'clarification', question: output.question });
  }

  const plan = output.steps;

  // 4b. Plan ready — persist workflow + tasks to DB
  const workflowResult = await createWorkflow(user.id, message, plan);
  if (!workflowResult.ok) {
    log.error({ error: workflowResult.error }, 'Failed to create workflow in DB');
    return err(workflowResult.error);
  }
  const workflowId = workflowResult.data;

  // 5. Kick off async DAG execution (non-blocking — returns immediately)
  executeWorkflow(workflowId).catch((e: unknown) => {
    log.error({ workflowId, err: e }, 'Workflow execution error (background)');
  });

  log.info({ workflowId, stepCount: plan.length }, 'Workflow started');
  return ok({ type: 'plan', workflowId, plan });
}
