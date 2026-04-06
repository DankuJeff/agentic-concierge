/**
 * Shared Anthropic client singleton.
 * All agents and the Conductor use this — never instantiate Anthropic directly.
 * Dotenv override is applied here so the key is available regardless of ESM import order.
 */

import { config as loadEnv } from 'dotenv';
loadEnv({ override: true });

import Anthropic from '@anthropic-ai/sdk';
import { childLogger } from './logger.js';

const log = childLogger({ module: 'claude-client' });

export const SPECIALIST_MODEL = 'claude-sonnet-4-6';
export const FALLBACK_MODEL = 'claude-haiku-4-5-20251001';
export const CONDUCTOR_MODEL = 'claude-opus-4-6';

let _client: Anthropic | undefined;

export function getClaudeClient(): Anthropic {
  if (!_client) {
    if (!process.env['ANTHROPIC_API_KEY']) {
      throw new Error('ANTHROPIC_API_KEY is not set. Copy .env.example to .env and fill it in.');
    }
    _client = new Anthropic({
      maxRetries: 2, // SDK-level retries; BullMQ handles job-level retries on top
    });
  }
  return _client;
}

/**
 * Drop-in wrapper around client.messages.create that automatically falls back
 * to Haiku when Sonnet returns 529 (overloaded). Conductors (Opus) are passed
 * through unchanged — Opus gets its own retry path.
 */
export async function createMessage(
  params: Anthropic.MessageCreateParamsNonStreaming,
): Promise<Anthropic.Message> {
  const client = getClaudeClient();

  try {
    return await client.messages.create(params);
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    const isOverloaded = errMsg.includes('529') || errMsg.includes('overloaded');
    const isSonnet = params.model === SPECIALIST_MODEL;

    if (isOverloaded && isSonnet) {
      log.warn({ originalModel: params.model }, `Sonnet overloaded — falling back to ${FALLBACK_MODEL}`);
      return await client.messages.create({ ...params, model: FALLBACK_MODEL });
    }

    throw e;
  }
}
