import { getClaudeClient } from '../shared/claude-client.js';
import { z } from 'zod';
import { TaskStepSchema, type TaskStep, type Result } from '../shared/types.js';
import { ok, err } from '../shared/types.js';
import { Errors } from '../shared/errors.js';
import { buildConductorPrompt } from './prompts/conductor-system.js';
import { childLogger } from '../shared/logger.js';

const log = childLogger({ module: 'decomposer' });

// ── Conductor output schemas ───────────────────────────────

const ClarificationSchema = z.object({
  type: z.literal('clarification'),
  question: z.string().min(1),
});

const PlanSchema = z.object({
  type: z.literal('plan'),
  steps: z.array(TaskStepSchema),
});

const ConductorOutputSchema = z.discriminatedUnion('type', [ClarificationSchema, PlanSchema]);

export type ConductorClarification = z.infer<typeof ClarificationSchema>;
export type ConductorPlan = z.infer<typeof PlanSchema>;
export type ConductorOutput = ConductorClarification | ConductorPlan;

/**
 * Calls the Conductor (claude-opus-4-6) with the user's message and returns
 * either a validated task graph (plan) or a clarifying question.
 *
 * Retries up to 3 times with exponential backoff on transient failures.
 */
export async function decompose(
  userMessage: string,
  userContext: Record<string, unknown>,
): Promise<Result<ConductorOutput>> {
  const systemPrompt = buildConductorPrompt(userContext);

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      log.info({ attempt, userMessage: userMessage.slice(0, 100) }, 'Calling Conductor');

      const response = await getClaudeClient().messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });

      const rawContent = response.content[0];
      if (!rawContent || rawContent.type !== 'text') {
        log.warn({ attempt }, 'Conductor returned non-text content');
        if (attempt < 3) {
          await sleep(attempt * 1000);
          continue;
        }
        return err(Errors.ANTHROPIC_ERROR('Conductor returned non-text content'));
      }

      // Strip any accidental markdown fences
      const jsonText = rawContent.text.trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, '');

      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonText);
      } catch {
        log.warn({ attempt, rawText: rawContent.text.slice(0, 200) }, 'Conductor output is not valid JSON');
        if (attempt < 3) {
          await sleep(attempt * 1000);
          continue;
        }
        return err(Errors.INVALID_TASK_GRAPH('Response is not valid JSON'));
      }

      // Legacy compatibility: raw JSON array → wrap as plan
      if (Array.isArray(parsed)) {
        parsed = { type: 'plan', steps: parsed };
      }

      const validated = ConductorOutputSchema.safeParse(parsed);
      if (!validated.success) {
        log.warn({ attempt, issues: validated.error.issues }, 'Conductor output failed Zod validation');
        if (attempt < 3) {
          await sleep(attempt * 1000);
          continue;
        }
        return err(Errors.INVALID_TASK_GRAPH(validated.error.message));
      }

      if (validated.data.type === 'clarification') {
        log.info({ question: validated.data.question.slice(0, 100) }, 'Conductor requesting clarification');
      } else {
        log.info({ stepCount: validated.data.steps.length }, 'Task graph decomposed successfully');
      }

      return ok(validated.data);
    } catch (e) {
      const isRetryable = attempt < 3;
      log.error({ attempt, err: e, isRetryable }, 'Conductor call failed');
      if (isRetryable) {
        await sleep(attempt * 1000);
        continue;
      }
      return err(Errors.ANTHROPIC_ERROR(e instanceof Error ? e.message : String(e)));
    }
  }

  // TypeScript requires this but the loop above always returns
  return err(Errors.ANTHROPIC_ERROR('Exhausted retries'));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
