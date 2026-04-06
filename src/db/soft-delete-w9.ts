/**
 * One-off script: soft-delete the cached W9 so it re-ingests with the new pdf-lib extractor.
 * Run: npx tsx src/db/soft-delete-w9.ts
 */
import 'dotenv/config';
import { db, documents } from './index.js';
import { eq, and, isNull } from 'drizzle-orm';

const rows = await db
  .update(documents)
  .set({ deletedAt: new Date() })
  .where(and(eq(documents.filename, 'TylerMunstock_W9Form.pdf'), isNull(documents.deletedAt)))
  .returning({ id: documents.id, filename: documents.filename });

if (rows.length === 0) {
  console.log('No matching document found (either not yet ingested or already soft-deleted) — nothing to do.');
} else {
  console.log('Soft-deleted:', JSON.stringify(rows));
}
process.exit(0);
