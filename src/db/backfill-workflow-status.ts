/**
 * One-time backfill: set stale 'active' workflow statuses based on their task outcomes.
 * Run once: npm run db:seed (or tsx src/db/backfill-workflow-status.ts)
 */
import 'dotenv/config';
import { db, workflows, tasks } from './index.js';
import { eq } from 'drizzle-orm';

const allWorkflows = await db
  .select({ id: workflows.id, status: workflows.status })
  .from(workflows);

let fixed = 0;

for (const wf of allWorkflows) {
  if (wf.status !== 'active') continue;

  const wfTasks = await db
    .select({ status: tasks.status })
    .from(tasks)
    .where(eq(tasks.workflowId, wf.id));

  if (wfTasks.length === 0) continue;

  const statuses = wfTasks.map((t) => t.status);

  let newStatus: 'failed' | 'completed' | null = null;
  if (statuses.some((s) => s === 'failed' || s === 'awaiting_recovery')) newStatus = 'failed';
  else if (statuses.every((s) => s === 'completed' || s === 'skipped')) newStatus = 'completed';

  if (newStatus) {
    await db
      .update(workflows)
      .set({ status: newStatus, updatedAt: new Date() })
      .where(eq(workflows.id, wf.id));
    console.log(`${wf.id.slice(0, 8)}... → ${newStatus}`);
    fixed++;
  }
}

console.log(`\nDone. Fixed ${fixed} workflow(s).`);
process.exit(0);
