/**
 * Finance Agent
 *
 * Pure reasoning agent — no tools, no browser.
 * Receives structured financial data from prior Research steps and returns
 * cost analysis, switching calculations, and savings projections.
 */

import { BaseAgent } from '../base-agent.js';
import { createMessage } from '../../shared/claude-client.js';
import { childLogger } from '../../shared/logger.js';
import { type AgentTaskInput, type AgentTaskOutput } from '../../shared/types.js';
import { buildFinancePrompt, PROMPT_VERSION } from './prompts/system.js';

const log = childLogger({ module: 'finance-agent' });

export class FinanceAgent extends BaseAgent {
  readonly agentName = 'finance';

  async run(task: AgentTaskInput): Promise<AgentTaskOutput> {
    log.info(
      { taskId: task.taskId, action: task.action, promptVersion: PROMPT_VERSION },
      'Finance Agent starting',
    );

    const systemPrompt = buildFinancePrompt({
      location: task.userContext['location'] as
        | { zip: string; city: string; state: string }
        | undefined,
      riskTolerance: task.userContext['riskTolerance'] as string | undefined,
      currentDate: new Date().toISOString().slice(0, 10),
      plaidConnected: task.userContext['plaidConnected'] as boolean | undefined,
      plaidAccounts: task.userContext['plaidAccounts'] as unknown[] | undefined,
    });

    const userMessage = JSON.stringify({
      task_id: task.taskId,
      action: task.action,
      inputs: task.inputs,
      constraints: task.constraints,
    });


    // Finance agent is single-turn — no tools, just structured reasoning.
    // Retry up to 3 times if output isn't valid JSON.
    for (let attempt = 1; attempt <= 3; attempt++) {
      const response = await createMessage({
        model: 'claude-sonnet-4-6',
        max_tokens: 8192,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });

      const block = response.content.find((b) => b.type === 'text');
      if (!block || block.type !== 'text') {
        log.warn({ taskId: task.taskId, attempt }, 'Finance Agent returned no text');
        if (attempt < 3) continue;
        return this.validateOutput({
          taskId: task.taskId,
          status: 'failed',
          sources: [],
          error: 'No text in response after 3 attempts',
        });
      }

      const result = this.parseAndValidate(task.taskId, block.text);

      // Only retry on parse failure — not on needs_input or failed status from the model
      if (result.status === 'failed' && result.error?.includes('not valid JSON') && attempt < 3) {
        log.warn({ taskId: task.taskId, attempt }, 'Finance Agent output not valid JSON — retrying');
        continue;
      }

      log.info({ taskId: task.taskId, status: result.status }, 'Finance Agent completed');
      return result;
    }

    return this.validateOutput({
      taskId: task.taskId,
      status: 'failed',
      sources: [],
      error: 'Exhausted retries without valid JSON output',
    });
  }

  private parseAndValidate(taskId: string, rawText: string): AgentTaskOutput {
    // Extract JSON — handle fenced blocks and prose preamble
    let json: string;
    const fenceMatch = rawText.match(/```json\s*([\s\S]*?)```/i);
    if (fenceMatch?.[1]) {
      json = fenceMatch[1].trim();
    } else {
      const start = rawText.indexOf('{');
      const end = rawText.lastIndexOf('}');
      json = start !== -1 && end > start ? rawText.slice(start, end + 1) : rawText.trim();
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      log.error({ taskId, rawText: rawText.slice(0, 300) }, 'Finance Agent output is not valid JSON');
      return this.validateOutput({
        taskId,
        status: 'failed',
        sources: [],
        error: 'Final response was not valid JSON',
      });
    }

    // Normalize snake_case keys Claude naturally outputs to camelCase
    const normalized = normalizeAgentOutput(parsed as Record<string, unknown>);
    return this.validateOutput(normalized);
  }
}

function normalizeAgentOutput(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };
  if ('task_id' in out) { out['taskId'] = out['task_id']; delete out['task_id']; }
  if ('needs_input_reason' in out) { out['needsInputReason'] = out['needs_input_reason']; delete out['needs_input_reason']; }
  if ('suggested_resolution' in out) { out['suggestedResolution'] = out['suggested_resolution']; delete out['suggested_resolution']; }
  return out;
}
