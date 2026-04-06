/**
 * Research Agent
 *
 * Receives a structured task from the Conductor, uses Claude Sonnet with
 * Playwright-backed tools (web_search, fetch_page) to gather information,
 * and returns a validated AgentTaskOutput.
 *
 * Tool-use loop:
 *   1. Call Claude with task description + tool definitions
 *   2. Execute any tool_use blocks (Playwright against Edge)
 *   3. Send tool_result back to Claude
 *   4. Repeat until Claude produces a final text response (structured JSON)
 *   5. Parse + validate against AgentTaskOutput schema
 */

import { chromium, type Browser } from 'playwright';
import type Anthropic from '@anthropic-ai/sdk';
import { BaseAgent } from '../base-agent.js';
import { createMessage, SPECIALIST_MODEL } from '../../shared/claude-client.js';
import { childLogger } from '../../shared/logger.js';
import { type AgentTaskInput, type AgentTaskOutput } from '../../shared/types.js';
import { buildResearchPrompt, PROMPT_VERSION } from './prompts/system.js';
import {
  RESEARCH_TOOL_DEFINITIONS,
  webSearch,
  fetchPage,
} from './tools.js';

const log = childLogger({ module: 'research-agent' });

/** Max tool-use rounds before forcing a final answer */
const MAX_TOOL_ROUNDS = 20;

/**
 * Claude outputs snake_case keys; our Zod schema uses camelCase.
 * Map the known mismatched fields before validation.
 */
function normalizeAgentOutput(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };
  if ('task_id' in out) { out['taskId'] = out['task_id']; delete out['task_id']; }
  if ('needs_input_reason' in out) { out['needsInputReason'] = out['needs_input_reason']; delete out['needs_input_reason']; }
  if ('suggested_resolution' in out) { out['suggestedResolution'] = out['suggested_resolution']; delete out['suggested_resolution']; }
  return out;
}

export class ResearchAgent extends BaseAgent {
  readonly agentName = 'research';

  async run(task: AgentTaskInput): Promise<AgentTaskOutput> {
    log.info(
      { taskId: task.taskId, action: task.action, promptVersion: PROMPT_VERSION },
      'Research Agent starting',
    );

    const systemPrompt = buildResearchPrompt({
      location: task.userContext['location'] as AgentTaskInput['userContext'] & {
        zip: string; city: string; state: string;
      } | undefined,
      detailLevel: task.userContext['detailLevel'] as string | undefined,
      currentDate: new Date().toISOString().slice(0, 10),
    });

    // Launch Edge once for the entire run — reused across all tool calls
    const browser = await chromium.launch({ channel: 'msedge', headless: true });

    try {
      const result = await this.runToolLoop(task, systemPrompt, browser);
      log.info({ taskId: task.taskId, status: result.status }, 'Research Agent completed');
      return result;
    } finally {
      await browser.close();
    }
  }

  private async runToolLoop(
    task: AgentTaskInput,
    systemPrompt: string,
    browser: Browser,
  ): Promise<AgentTaskOutput> {

    const userMessage = JSON.stringify({
      task_id: task.taskId,
      action: task.action,
      inputs: task.inputs,
      constraints: task.constraints,
    });

    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: userMessage },
    ];

    let totalToolCalls = 0;
    const MAX_TOOL_CALLS = 12;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await createMessage({
        model: SPECIALIST_MODEL,
        max_tokens: 8192,
        system: systemPrompt,
        tools: RESEARCH_TOOL_DEFINITIONS,
        tool_choice: { type: 'auto', disable_parallel_tool_use: true },
        messages,
      });

      log.debug(
        { taskId: task.taskId, round, stopReason: response.stop_reason },
        'Claude response received',
      );

      // ── Final answer ───────────────────────────────────
      if (response.stop_reason === 'end_turn') {
        const textBlock = response.content.find((b) => b.type === 'text');
        if (!textBlock || textBlock.type !== 'text') {
          return this.validateOutput({
            taskId: task.taskId,
            status: 'failed',
            sources: [],
            error: 'Claude returned no text in final response',
          });
        }
        return this.parseAndValidate(task.taskId, textBlock.text);
      }

      // ── Tool calls ─────────────────────────────────────
      if (response.stop_reason === 'tool_use') {
        // Add assistant's response (with tool_use blocks) to message history
        messages.push({ role: 'assistant', content: response.content });

        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
        totalToolCalls += toolUseBlocks.length;

        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;

          const toolResult = await this.executeTool(browser, block.name, block.input as Record<string, unknown>, task.taskId);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: toolResult,
          });
        }

        messages.push({ role: 'user', content: toolResults });

        // If we've hit the tool call budget, push a synthesis instruction and
        // force tool_choice=none so Claude must respond with text only
        if (totalToolCalls >= MAX_TOOL_CALLS) {
          messages.push({
            role: 'user',
            content: 'Tool call budget reached. Write your final JSON response now using only the data already gathered. Do not call any more tools.',
          });

          const finalResponse = await createMessage({
            model: SPECIALIST_MODEL,
            max_tokens: 8192,
            system: systemPrompt,
            tools: RESEARCH_TOOL_DEFINITIONS,
            tool_choice: { type: 'none' },
            messages,
          });

          const textBlock = finalResponse.content.find((b) => b.type === 'text');
          if (textBlock && textBlock.type === 'text') {
            return this.parseAndValidate(task.taskId, textBlock.text);
          }
          break;
        }

        continue;
      }

      // Unexpected stop reason
      break;
    }

    // Exhausted rounds without a final answer
    log.warn({ taskId: task.taskId }, 'Research Agent exhausted tool rounds without final answer');
    return this.validateOutput({
      taskId: task.taskId,
      status: 'failed',
      sources: [],
      error: `Exhausted ${MAX_TOOL_ROUNDS} tool rounds without producing a final result`,
    });
  }

  private async executeTool(
    browser: Browser,
    toolName: string,
    input: Record<string, unknown>,
    taskId: string,
  ): Promise<string> {
    log.info({ taskId, toolName, input }, 'Executing tool');

    try {
      switch (toolName) {
        case 'web_search': {
          const query = input['query'] as string;
          const maxResults = (input['max_results'] as number | undefined) ?? 5;
          const results = await webSearch(browser, query, maxResults);
          return JSON.stringify(results);
        }

        case 'fetch_page': {
          const url = input['url'] as string;
          const content = await fetchPage(browser, url);
          return content;
        }

        default:
          log.warn({ taskId, toolName }, 'Unknown tool called');
          return JSON.stringify({ error: `Unknown tool: ${toolName}` });
      }
    } catch (err) {
      log.error({ taskId, toolName, err }, 'Tool execution failed');
      return JSON.stringify({ error: `Tool ${toolName} failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  private parseAndValidate(taskId: string, rawText: string): AgentTaskOutput {
    // Extract JSON: handle prose-before-JSON and markdown fences.
    // Try in order: fenced block → first { to last } → raw text.
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
      log.error({ taskId, rawText: rawText.slice(0, 300) }, 'Research Agent output is not valid JSON');
      return this.validateOutput({
        taskId,
        status: 'failed',
        sources: [],
        error: 'Final response was not valid JSON',
      });
    }

    // Normalize snake_case keys that Claude naturally outputs to camelCase
    // to match AgentTaskOutputSchema field names.
    const normalized = normalizeAgentOutput(parsed as Record<string, unknown>);
    return this.validateOutput(normalized);
  }
}
