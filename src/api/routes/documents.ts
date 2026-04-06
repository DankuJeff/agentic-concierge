/**
 * Document upload and listing routes.
 *
 * POST /documents — upload a file (base64-encoded JSON body) and ingest it.
 * GET  /documents — list all documents for the authenticated user.
 *
 * Phase 1 prototype: accepts base64-encoded content to avoid needing @fastify/multipart.
 * Phase 4 upgrade: replace with proper multipart upload.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { childLogger } from '../../shared/logger.js';
import { ingestDocument } from '../../agents/document/ingest.js';
import { listDocuments } from '../../agents/document/tools.js';
import { writeAuditLog } from '../../shared/audit.js';

const log = childLogger({ module: 'routes/documents' });

const UploadBodySchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1),
  content: z.string().min(1), // base64-encoded file content
});

export async function documentRoutes(app: FastifyInstance): Promise<void> {
  // POST /documents — ingest a document for the authenticated user
  app.post('/documents', async (request, reply) => {
    const parseResult = UploadBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: parseResult.error.message },
      });
    }

    const { filename, mimeType, content } = parseResult.data;
    const userId = request.user.id;

    let buffer: Buffer;
    try {
      buffer = Buffer.from(content, 'base64');
    } catch {
      return reply.code(400).send({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'content must be valid base64' },
      });
    }

    log.info({ filename, mimeType, bytes: buffer.length, userId }, 'POST /documents');

    const result = await ingestDocument(userId, filename, mimeType, buffer);

    if (!result.ok) {
      return reply.code(422).send({ ok: false, error: result.error });
    }

    await writeAuditLog({
      userId,
      eventType: 'document.uploaded',
      entityType: 'document',
      entityId: result.data.documentId,
      metadata: { filename, mimeType, characterCount: result.data.characterCount },
      ipAddress: request.ip,
    });

    return reply.code(201).send({ ok: true, data: result.data });
  });

  // GET /documents — list all documents for the authenticated user
  app.get('/documents', async (request, reply) => {
    const userId = request.user.id;
    const docs = await listDocuments(userId);
    return reply.send({ ok: true, data: docs });
  });
}
