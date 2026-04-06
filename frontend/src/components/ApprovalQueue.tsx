import { useEffect, useState, useCallback } from 'react';

interface PendingTask {
  id: string;
  workflowId: string;
  agent: string;
  action: string;
  inputs: Record<string, unknown>;
  autonomy: number;
  status: string;
  createdAt: string;
  workflowName: string;
  workflowStatus: string;
}

const AUTONOMY_LABEL: Record<number, string> = { 1: 'Auto', 2: 'Approve', 3: 'Confirm' };
const AUTONOMY_COLOR: Record<number, string> = {
  1: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25',
  2: 'bg-amber-500/10 text-amber-400 border border-amber-500/25',
  3: 'bg-red-500/10 text-red-400 border border-red-500/25',
};

export default function ApprovalQueue() {
  const [tasks, setTasks] = useState<PendingTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null); // task ID currently being approved/rejected
  const [error, setError] = useState<string | null>(null);

  const fetchPending = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch('/api/tasks/pending-approval')
      .then((r) => r.json() as Promise<{ ok: boolean; data: PendingTask[] }>)
      .then((json) => {
        if (json.ok) setTasks(json.data);
        else setError('Failed to load approval queue.');
      })
      .catch(() => setError('Server unreachable.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchPending();
    // Poll every 8 seconds so new approval requests appear automatically
    const interval = setInterval(fetchPending, 8_000);
    return () => clearInterval(interval);
  }, [fetchPending]);

  async function handleAction(taskId: string, action: 'approve' | 'reject') {
    setActing(taskId);
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/${action}`, {
        method: 'POST',
      });
      const json = await res.json() as { ok: boolean; error?: { message: string } };
      if (!json.ok) {
        setError(json.error?.message ?? `Failed to ${action} task.`);
      }
    } catch {
      setError('Server unreachable.');
    } finally {
      setActing(null);
      fetchPending();
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-100">Approval Queue</h2>
        <button
          onClick={fetchPending}
          disabled={loading}
          className="text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-40 transition-colors"
        >
          Refresh
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-3">
        {error && (
          <div className="rounded-xl bg-red-500/10 border border-red-500/25 px-4 py-2.5 text-sm text-red-400">{error}</div>
        )}
        {loading && <p className="text-sm text-zinc-500">Loading…</p>}
        {!loading && tasks.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center mb-3">
              <svg className="w-5 h-5 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-sm text-zinc-400 font-medium">All clear</p>
            <p className="text-xs text-zinc-600 mt-1">No tasks awaiting approval.</p>
          </div>
        )}

        {tasks.map((t) => {
          const isActing = acting === t.id;
          return (
            <div key={t.id} className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-zinc-200">{t.action}</p>
                  <p className="text-xs text-zinc-500">
                    Workflow: <span className="font-medium text-zinc-300">{t.workflowName}</span>
                    {' · '}
                    Agent: <span className="capitalize text-zinc-400">{t.agent}</span>
                  </p>
                </div>
                <span
                  className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-md ${
                    AUTONOMY_COLOR[t.autonomy] ?? 'bg-zinc-800 text-zinc-400'
                  }`}
                >
                  Level {t.autonomy} — {AUTONOMY_LABEL[t.autonomy]}
                </span>
              </div>

              {Object.keys(t.inputs).length > 0 && (
                <details className="text-xs text-zinc-500">
                  <summary className="cursor-pointer select-none hover:text-zinc-300 transition-colors">View inputs</summary>
                  <pre className="mt-2 bg-zinc-950 border border-zinc-800 rounded-lg p-3 overflow-x-auto text-zinc-500 whitespace-pre-wrap text-xs">
                    {JSON.stringify(t.inputs, null, 2)}
                  </pre>
                </details>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => void handleAction(t.id, 'approve')}
                  disabled={isActing}
                  className="flex-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 transition-colors"
                >
                  {isActing ? 'Working…' : 'Approve'}
                </button>
                <button
                  onClick={() => void handleAction(t.id, 'reject')}
                  disabled={isActing}
                  className="flex-1 rounded-lg bg-red-500/10 border border-red-500/25 px-3 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-500/15 disabled:opacity-50 transition-colors"
                >
                  {isActing ? 'Working…' : 'Reject'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
