/**
 * Document Agent — Tool definitions and implementations.
 *
 * Tools hit the PostgreSQL documents table directly.
 * Search uses PostgreSQL ILIKE (full-text) for Phase 1 — no embedding provider
 * required. When an embedding provider is added, upgrade search_documents to
 * cosine similarity via pgvector.
 *
 * All tools accept a userId so they're multi-tenant-ready when Phase 4 adds auth.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { eq, and, isNull } from 'drizzle-orm';
import { db, documents } from '../../db/index.js';
import { childLogger } from '../../shared/logger.js';
import { decryptField } from '../../shared/encryption.js';

const log = childLogger({ module: 'document-tools' });

// ── Types ───────────────────────────────────────────────────

export interface DocumentSummary {
  id: string;
  filename: string;
  mimeType: string;
  createdAt: Date;
}

export interface SearchHit {
  id: string;
  filename: string;
  snippet: string;
}

// ── Claude tool definitions ─────────────────────────────────

export const DOCUMENT_TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: 'list_documents',
    description:
      "List all documents in the user's document vault. " +
      'Returns document IDs, filenames, MIME types, and upload dates. ' +
      'Call this first when you need to discover what documents are available.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'search_documents',
    description:
      'Keyword search over all documents. ' +
      'Returns matching document IDs, filenames, and text snippets (up to 300 chars each). ' +
      'Use this to find relevant documents when you have a topic but no specific ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Keyword or phrase to search for in document content.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum results to return. Default: 5. Max: 10.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_document',
    description:
      'Read the full parsed text of a document by its UUID. ' +
      'Returns up to 8,000 characters of content. ' +
      'Use this after locating a document via list or search.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'string',
          description: 'The document UUID to read.',
        },
      },
      required: ['id'],
    },
  },
];

// ── Tool implementations ────────────────────────────────────

export async function listDocuments(userId: string): Promise<DocumentSummary[]> {
  try {
    const rows = await db
      .select({
        id: documents.id,
        filename: documents.filename,
        mimeType: documents.mimeType,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .where(and(eq(documents.userId, userId), isNull(documents.deletedAt)))
      .orderBy(documents.createdAt);

    log.info({ userId, count: rows.length }, 'list_documents completed');
    return rows;
  } catch (err) {
    log.error({ userId, err }, 'list_documents failed');
    return [];
  }
}

export async function searchDocuments(
  userId: string,
  query: string,
  limit = 5,
): Promise<SearchHit[]> {
  const capped = Math.min(limit, 10);

  try {
    // content_text is encrypted — SQL ILIKE cannot operate on ciphertext.
    // Fetch all docs for this user, decrypt in-app, filter by word matching.
    // Acceptable for prototype scale (single user, ~10s of documents).
    // Phase 5: replace with pgvector cosine similarity once embeddings are added.
    const rows = await db
      .select({
        id: documents.id,
        filename: documents.filename,
        contentText: documents.contentText,
      })
      .from(documents)
      .where(and(eq(documents.userId, userId), isNull(documents.deletedAt)));

    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const queryLower = query.trim().toLowerCase();

    const hits: SearchHit[] = [];
    for (const row of rows) {
      if (hits.length >= capped) break;

      const plaintext = decryptField(row.contentText);
      const plaintextLower = plaintext.toLowerCase();
      const filenameMatch = row.filename.toLowerCase().includes(queryLower);
      const contentMatch = words.every((w) => plaintextLower.includes(w));

      if (filenameMatch || contentMatch) {
        hits.push({
          id: row.id,
          filename: row.filename,
          snippet: extractSnippet(plaintext, query, 300),
        });
      }
    }

    log.info({ userId, query, count: hits.length }, 'search_documents completed');
    return hits;
  } catch (err) {
    log.error({ userId, query, err }, 'search_documents failed');
    return [];
  }
}

export async function readDocument(userId: string, id: string): Promise<string> {
  try {
    const rows = await db
      .select({
        filename: documents.filename,
        mimeType: documents.mimeType,
        contentText: documents.contentText,
        metadata: documents.metadata,
      })
      .from(documents)
      .where(and(eq(documents.id, id), eq(documents.userId, userId), isNull(documents.deletedAt)))
      .limit(1);

    const doc = rows[0];
    if (!doc) {
      log.warn({ userId, id }, 'read_document: not found');
      return JSON.stringify({ error: `Document ${id} not found.` });
    }

    const content = decryptField(doc.contentText).slice(0, 32000);
    log.info({ userId, id, filename: doc.filename, length: content.length }, 'read_document completed');
    return JSON.stringify({ filename: doc.filename, mimeType: doc.mimeType, content });
  } catch (err) {
    log.error({ userId, id, err }, 'read_document failed');
    return JSON.stringify({
      error: `Failed to read document: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

// ── Helpers ─────────────────────────────────────────────────

/**
 * Extract a snippet from text centred around the first occurrence of the query term.
 * Falls back to the beginning of the text if the term isn't found.
 */
function extractSnippet(text: string, query: string, maxLength: number): string {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text.slice(0, maxLength);

  const start = Math.max(0, idx - 60);
  const end = Math.min(text.length, start + maxLength);
  const snippet = text.slice(start, end);
  return start > 0 ? `...${snippet}` : snippet;
}
