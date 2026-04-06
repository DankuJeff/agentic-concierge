import { useEffect, useState } from 'react';

interface AgentStats {
  total: number;
  completed: number;
  failed: number;
}

interface AnalyticsSummary {
  workflows: {
    total: number;
    completed: number;
    failed: number;
    active: number;
    completionRate: number | null;
  };
  tasks: {
    total: number;
    completed: number;
    failed: number;
    completionRate: number | null;
    byAgent: Record<string, AgentStats>;
  };
  performance: {
    avgWorkflowDurationMs: number | null;
    recoveredTasks: number;
  };
  satisfaction: {
    total: number;
    positive: number;
    negative: number;
    score: number | null;
  };
  recentWorkflows: {
    id: string;
    name: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  }[];
}

const WORKFLOW_STATUS_COLOR: Record<string, string> = {
  active: 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/25',
  paused: 'bg-amber-500/10 text-amber-400 border border-amber-500/25',
  awaiting_user: 'bg-amber-500/10 text-amber-400 border border-amber-500/25',
  completed: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25',
  failed: 'bg-red-500/10 text-red-400 border border-red-500/25',
  cancelled: 'bg-zinc-800 text-zinc-500',
};

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return rem > 0 ? `${minutes}m ${rem}s` : `${minutes}m`;
}

function formatRate(rate: number | null): string {
  if (rate === null) return '—';
  return `${(rate * 100).toFixed(0)}%`;
}

function MetricCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="metric-card rounded-xl p-4">
      <p className="text-xs text-zinc-600 uppercase tracking-widest font-semibold mb-2">{label}</p>
      <p className="text-2xl font-bold text-zinc-100">{value}</p>
      {sub && <p className="text-xs text-zinc-500 mt-1">{sub}</p>}
    </div>
  );
}

export default function AnalyticsDashboard() {
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/analytics/summary', { credentials: 'include' })
      .then((res) => (res.ok ? (res.json() as Promise<{ ok: boolean; data: AnalyticsSummary }>) : Promise.reject(res.status)))
      .then((json) => { if (json.ok) setData(json.data); })
      .catch(() => setError('Failed to load analytics.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-red-400">{error ?? 'No data available.'}</p>
      </div>
    );
  }

  const agentEntries = Object.entries(data.tasks.byAgent).sort(
    (a, b) => b[1].total - a[1].total,
  );

  return (
    <div className="h-full overflow-y-auto px-6 py-6 space-y-6">
      <div>
        <p className="text-xs font-semibold text-indigo-400 uppercase tracking-widest mb-1">Analytics</p>
        <h2 className="text-xl font-bold text-zinc-100">Performance overview</h2>
      </div>

      {/* Top metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Workflows run"
          value={String(data.workflows.total)}
          sub={`${data.workflows.active} active`}
        />
        <MetricCard
          label="Completion rate"
          value={formatRate(data.workflows.completionRate)}
          sub={`${data.workflows.completed} completed · ${data.workflows.failed} failed`}
        />
        <MetricCard
          label="Tasks run"
          value={String(data.tasks.total)}
          sub={`${formatRate(data.tasks.completionRate)} success rate`}
        />
        <MetricCard
          label="Avg duration"
          value={formatDuration(data.performance.avgWorkflowDurationMs)}
          sub="per completed workflow"
        />
      </div>

      {/* Agent breakdown + satisfaction */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 metric-card rounded-xl p-4">
          <p className="text-xs text-zinc-600 uppercase tracking-widest font-semibold mb-3">
            Agent performance
          </p>
          {agentEntries.length === 0 ? (
            <p className="text-sm text-zinc-500 italic">No tasks yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-zinc-600 uppercase tracking-widest">
                  <th className="text-left pb-2 font-semibold">Agent</th>
                  <th className="text-right pb-2 font-semibold">Tasks</th>
                  <th className="text-right pb-2 font-semibold">Completed</th>
                  <th className="text-right pb-2 font-semibold">Failed</th>
                  <th className="text-right pb-2 font-semibold">Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {agentEntries.map(([agent, stats]) => {
                  const rate =
                    stats.completed + stats.failed > 0
                      ? stats.completed / (stats.completed + stats.failed)
                      : null;
                  return (
                    <tr key={agent}>
                      <td className="py-2 text-zinc-300 capitalize font-medium">{agent}</td>
                      <td className="py-2 text-right text-zinc-400">{stats.total}</td>
                      <td className="py-2 text-right text-emerald-400">{stats.completed}</td>
                      <td className="py-2 text-right text-red-400">{stats.failed}</td>
                      <td className="py-2 text-right text-zinc-400">{formatRate(rate)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {data.performance.recoveredTasks > 0 && (
            <p className="text-xs text-zinc-600 mt-3">
              {data.performance.recoveredTasks} task
              {data.performance.recoveredTasks !== 1 ? 's' : ''} needed recovery
            </p>
          )}
        </div>

        <div className="metric-card rounded-xl p-4">
          <p className="text-xs text-zinc-600 uppercase tracking-widest font-semibold mb-3">
            Satisfaction
          </p>
          {data.satisfaction.total === 0 ? (
            <p className="text-sm text-zinc-500 italic">
              No feedback yet. Rate completed workflows in the Workflows tab.
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-2xl font-bold text-zinc-100">
                {formatRate(data.satisfaction.score)}
              </p>
              <p className="text-xs text-zinc-500">
                {data.satisfaction.total} response{data.satisfaction.total !== 1 ? 's' : ''}
              </p>
              <div className="flex gap-4 text-sm">
                <span className="text-emerald-400 font-medium">+{data.satisfaction.positive} helpful</span>
                <span className="text-red-400 font-medium">–{data.satisfaction.negative} not helpful</span>
              </div>
              <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all"
                  style={{ width: `${(data.satisfaction.score ?? 0) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Recent workflows */}
      <div className="metric-card rounded-xl p-4">
        <p className="text-xs text-zinc-600 uppercase tracking-widest font-semibold mb-3">
          Recent workflows
        </p>
        {data.recentWorkflows.length === 0 ? (
          <p className="text-sm text-zinc-500 italic">No workflows yet.</p>
        ) : (
          <div className="divide-y divide-zinc-800/60">
            {data.recentWorkflows.map((w) => (
              <div key={w.id} className="flex items-center gap-3 py-2.5">
                <span
                  className={`shrink-0 text-xs font-medium px-1.5 py-0.5 rounded-md capitalize ${
                    WORKFLOW_STATUS_COLOR[w.status] ?? 'bg-zinc-800 text-zinc-500'
                  }`}
                >
                  {w.status}
                </span>
                <span className="flex-1 text-sm text-zinc-300 truncate">{w.name}</span>
                <span className="text-xs text-zinc-600 shrink-0">
                  {new Date(w.createdAt).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
