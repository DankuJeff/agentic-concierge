import { config } from 'dotenv';
config({ override: true });
const { db, documents } = await import('./src/db/index.js');
const rows = await db.select({ filename: documents.filename, contentText: documents.contentText }).from(documents);
for (const r of rows) {
  console.log('FILE:', r.filename, '| CHARS:', r.contentText.length);
  console.log(r.contentText.slice(0, 600));
  console.log('---');
}
process.exit(0);
