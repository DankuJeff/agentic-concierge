/**
 * Document Agent
 *
 * Tool-use agent that reads and analyzes documents stored in the user's vault.
 * Tools: list_documents, search_documents, read_document (all hit PostgreSQL directly).
 * No browser, no external requests — all data lives in the local DB.
 *
 * Tool loop mirrors the Research Agent pattern.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { BaseAgent } from '../base-agent.js';
import { createMessage, SPECIALIST_MODEL } from '../../shared/claude-client.js';
import { childLogger } from '../../shared/logger.js';
import { type AgentTaskInput, type AgentTaskOutput } from '../../shared/types.js';
import { buildDocumentPrompt, PROMPT_VERSION } from './prompts/system.js';
import {
  DOCUMENT_TOOL_DEFINITIONS,
  listDocuments,
  searchDocuments,
  readDocument,
} from './tools.js';
import { PROTOTYPE_USER_ID } from '../../db/seed.js';

const log = childLogger({ module: 'document-agent' });

/** Max tool-use rounds before forcing a final answer */
const MAX_TOOL_ROUNDS = 8;
/** Max individual tool calls before forcing synthesis */
const MAX_TOOL_CALLS = 6;

export class DocumentAgent extends BaseAgent {
  readonly agentName = 'document';

  async run(task: AgentTaskInput): Promise<AgentTaskOutput> {
    log.info(
      { taskId: task.taskId, action: task.action, promptVersion: PROMPT_VERSION },
      'Document Agent starting',
    );

    // Single-user prototype: fall back to PROTOTYPE_USER_ID if not in context
    const userId = (task.userContext['userId'] as string | undefined) ?? PROTOTYPE_USER_ID;

    const systemPrompt = buildDocumentPrompt({
      userName: task.userContext['userName'] as string | undefined,
      currentDate: new Date().toISOString().slice(0, 10),
    });

    const result = await this.runToolLoop(task, systemPrompt, userId);
    log.info({ taskId: task.taskId, status: result.status }, 'Document Agent completed');
    return result;
  }

  private async runToolLoop(
    task: AgentTaskInput,
    systemPrompt: string,
    userId: string,
  ): Promise<AgentTaskOutput> {
    const userMessage = JSON.stringify({
      task_id: task.taskId,
      action: task.action,
      inputs: task.inputs,
      constraints: task.constraints,
    });

    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMessage }];

    let totalToolCalls = 0;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await createMessage({
        model: SPECIALIST_MODEL,
        max_tokens: 8192,
        system: systemPrompt,
        tools: DOCUMENT_TOOL_DEFINITIONS,
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
            error: 'Document Agent returned no text in final response',
          });
        }
        return this.parseAndValidate(task.taskId, textBlock.text);
      }

      // ── Tool calls ─────────────────────────────────────
      if (response.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: response.content });

        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
        totalToolCalls += toolUseBlocks.length;

        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;

          const toolResult = await this.executeTool(
            block.name,
            block.input as Record<string, unknown>,
            userId,
            task.taskId,
          );

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: toolResult,
          });
        }

        messages.push({ role: 'user', content: toolResults });

        // Force synthesis if tool call budget is exhausted
        if (totalToolCalls >= MAX_TOOL_CALLS) {
          messages.push({
            role: 'user',
            content:
              'Tool call budget reached. Write your final JSON response now using only the data already gathered.',
          });

          const finalResponse = await createMessage({
            model: SPECIALIST_MODEL,
            max_tokens: 8192,
            system: systemPrompt,
            tools: DOCUMENT_TOOL_DEFINITIONS,
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

      break;
    }

    log.warn({ taskId: task.taskId }, 'Document Agent exhausted tool rounds without final answer');
    return this.validateOutput({
      taskId: task.taskId,
      status: 'failed',
      sources: [],
      error: `Exhausted ${MAX_TOOL_ROUNDS} tool rounds without producing a result`,
    });
  }

  private async executeTool(
    toolName: string,
    input: Record<string, unknown>,
    userId: string,
    taskId: string,
  ): Promise<string> {
    log.info({ taskId, toolName, input }, 'Executing tool');

    try {
      switch (toolName) {
        case 'list_documents': {
          const docs = await listDocuments(userId);
          return JSON.stringify(docs);
        }

        case 'search_documents': {
          const query = input['query'] as string;
          const limit = (input['limit'] as number | undefined) ?? 5;
          const hits = await searchDocuments(userId, query, limit);
          return JSON.stringify(hits);
        }

        case 'read_document': {
          const id = input['id'] as string;
          return await readDocument(userId, id);
        }

        default:
          log.warn({ taskId, toolName }, 'Unknown tool called');
          return JSON.stringify({ error: `Unknown tool: ${toolName}` });
      }
    } catch (e) {
      log.error({ taskId, toolName, err: e }, 'Tool execution failed');
      return JSON.stringify({
        error: `Tool ${toolName} failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  private parseAndValidate(taskId: string, rawText: string): AgentTaskOutput {
    // Extract JSON: handle fenced blocks and prose preamble
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
      log.error({ taskId, rawText: rawText.slice(0, 300) }, 'Document Agent output is not valid JSON');
      return this.validateOutput({
        taskId,
        status: 'failed',
        sources: [],
        error: 'Final response was not valid JSON',
      });
    }

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
