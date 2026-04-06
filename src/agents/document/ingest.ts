/**
 * Document Ingestion — parses uploaded files and stores them in the documents table.
 *
 * Supported formats: PDF (pdf-parse + pdf-lib AcroForm), DOCX (mammoth), plain text.
 * Vector embeddings: deferred to Phase 4 when an embedding provider is added.
 *   The embedding column is left NULL until then.
 */

import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup } from 'pdf-lib';
import { db, documents } from '../../db/index.js';
import { eq, and, isNull } from 'drizzle-orm';
import { childLogger } from '../../shared/logger.js';
import type { Result } from '../../shared/types.js';
import { ok, err } from '../../shared/types.js';
import { Errors } from '../../shared/errors.js';
import { encryptField, decryptField } from '../../shared/encryption.js';

const log = childLogger({ module: 'document-ingest' });

export interface IngestResult {
  documentId: string;
  filename: string;
  characterCount: number;
}

/**
 * Parse a file buffer and store the extracted text in the documents table.
 * Returns the new document's UUID on success.
 */
export async function ingestDocument(
  userId: string,
  filename: string,
  mimeType: string,
  buffer: Buffer,
): Promise<Result<IngestResult>> {
  try {
    // Return existing document if same filename already exists for this user (avoid duplicate uploads)
    const existing = await db
      .select({ id: documents.id, contentText: documents.contentText })
      .from(documents)
      .where(and(eq(documents.userId, userId), eq(documents.filename, filename), isNull(documents.deletedAt)))
      .limit(1);

    if (existing[0]) {
      log.info({ userId, filename, documentId: existing[0].id }, 'Document already exists — returning existing record');
      const existingText = decryptField(existing[0].contentText);
      return ok({ documentId: existing[0].id, filename, characterCount: existingText.length });
    }

    const contentText = await extractText(filename, mimeType, buffer);

    if (!contentText.trim()) {
      return err(Errors.VALIDATION_ERROR('Document appears to be empty or could not be parsed.'));
    }

    const rows = await db
      .insert(documents)
      .values({
        userId,
        filename,
        mimeType,
        contentText: encryptField(contentText),
        // embedding: null — Phase 1 prototype, no embedding provider yet
        metadata: { originalSize: buffer.length, characterCount: contentText.length },
      })
      .returning({ id: documents.id });

    const documentId = rows[0]?.id;
    if (!documentId) {
      return err(Errors.DB_ERROR('Insert returned no document ID.'));
    }

    log.info({ userId, documentId, filename, chars: contentText.length }, 'Document ingested');
    return ok({ documentId, filename, characterCount: contentText.length });
  } catch (e) {
    log.error({ userId, filename, err: e }, 'Document ingestion failed');
    return err(Errors.DB_ERROR(e instanceof Error ? e.message : String(e)));
  }
}

async function extractText(filename: string, mimeType: string, buffer: Buffer): Promise<string> {
  const lowerMime = mimeType.toLowerCase();
  const lowerName = filename.toLowerCase();

  // PDF — extract static text via pdf-parse AND form field values via pdf-lib
  if (lowerMime === 'application/pdf' || lowerName.endsWith('.pdf')) {
    const parsePromise = extractPdfText(buffer);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('PDF parsing timed out after 60 seconds')), 60_000),
    );
    return await Promise.race([parsePromise, timeoutPromise]);
  }

  // DOCX
  if (
    lowerMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    lowerName.endsWith('.docx')
  ) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value ?? '';
  }

  // Plain text — return as-is
  if (lowerMime.startsWith('text/') || lowerName.endsWith('.txt') || lowerName.endsWith('.md')) {
    return buffer.toString('utf-8');
  }

  throw new Error(`Unsupported file type: ${mimeType} (${filename})`);
}

/**
 * Extracts text from a PDF combining two passes:
 * 1. pdf-parse — static content stream (body text, labels)
 * 2. pdf-lib — AcroForm field values (works in Node, zero browser dependencies)
 *
 * The form fields section is appended as "FORM FIELD VALUES:" so the LLM
 * can easily distinguish labels from the values the user filled in.
 */
async function extractPdfText(buffer: Buffer): Promise<string> {
  // Pass 1: static text via pdf-parse (body text, labels, instructions)
  let staticText = '';
  try {
    const parsed = await pdfParse(buffer);
    staticText = parsed.text ?? '';
  } catch {
    // continue — pdf-lib may still get form fields
  }

  // Pass 2: AcroForm field values via pdf-lib (pure JS, no browser DOM required)
  const formFields: string[] = [];
  try {
    const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const form = pdfDoc.getForm();
    const fields = form.getFields();
    for (const field of fields) {
      const name = field.getName();
      let value = '';
      if (field instanceof PDFTextField) {
        value = field.getText() ?? '';
      } else if (field instanceof PDFCheckBox) {
        value = field.isChecked() ? 'checked' : '';
      } else if (field instanceof PDFDropdown) {
        value = field.getSelected().join(', ');
      } else if (field instanceof PDFRadioGroup) {
        value = field.getSelected() ?? '';
      }
      if (value.trim()) {
        formFields.push(`${name}: ${value}`);
      }
    }
  } catch {
    // Form field extraction is best-effort
  }

  if (formFields.length === 0) return staticText;
  return `${staticText}\n\nFORM FIELD VALUES:\n${formFields.join('\n')}`;
}
