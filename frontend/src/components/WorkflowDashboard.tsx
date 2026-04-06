import { useEffect, useRef, useState } from 'react';

interface WorkflowSummary {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface TaskRow {
  id: string;
  agent: string;
  action: string;
  autonomy: number;
  status: string;
  result: unknown;
  error: string | null;
  completedAt: string | null;
}

interface WorkflowDetail extends WorkflowSummary {
  tasks: TaskRow[];
}

interface TaskStatusEvent {
  workflowId: string;
  taskId: string;
  agent: string;
  status: string;
  updatedAt: string;
}

const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-zinc-800 text-zinc-500',
  running: 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/25',
  awaiting_user: 'bg-amber-500/10 text-amber-400 border border-amber-500/25',
  awaiting_recovery: 'bg-orange-500/10 text-orange-400 border border-orange-500/25',
  completed: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25',
  failed: 'bg-red-500/10 text-red-400 border border-red-500/25',
  skipped: 'bg-zinc-800 text-zinc-600',
};

const WORKFLOW_STATUS_COLOR: Record<string, string> = {
  active: 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/25',
  paused: 'bg-amber-500/10 text-amber-400 border border-amber-500/25',
  awaiting_user: 'bg-amber-500/10 text-amber-400 border border-amber-500/25',
  completed: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25',
  failed: 'bg-red-500/10 text-red-400 border border-red-500/25',
  cancelled: 'bg-zinc-800 text-zinc-500',
};

// ── Readable result renderer ───────────────────────────────

const SKIP_FIELDS = new Set(['taskId', 'workflowId', 'task_id', 'workflow_id']);

function humanLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase())
    .trim();
}

interface RankedOption {
  rank: number;
  option: string;
  strengths: string[];
  weaknesses: string[];
  risks: string[];
  totalScore: number;
  criteriaScores?: Record<string, number>;
}

function ResultValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    return <p className="text-sm text-zinc-300 whitespace-pre-wrap">{value}</p>;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return <p className="text-sm text-zinc-300">{String(value)}</p>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (typeof value[0] !== 'object') {
      return (
        <ul className="space-y-0.5 mt-0.5">
          {(value as (string | number)[]).map((item, i) => (
            <li key={i} className="text-sm text-zinc-300 flex gap-2">
              <span className="text-zinc-600 shrink-0">•</span>
              <span>{String(item)}</span>
            </li>
          ))}
        </ul>
      );
    }
    if (depth < 2) {
      return (
        <div className="space-y-2 mt-1">
          {(value as Record<string, unknown>[]).map((item, i) => (
            <div key={i} className="bg-zinc-950 border border-zinc-800 rounded-lg p-2.5">
              <ResultObject obj={item} depth={depth + 1} />
            </div>
          ))}
        </div>
      );
    }
    return null;
  }
  if (typeof value === 'object') {
    return <ResultObject obj={value as Record<string, unknown>} depth={depth} />;
  }
  return null;
}

function ResultObject({ obj, depth = 0 }: { obj: Record<string, unknown>; depth?: number }) {
  const entries = Object.entries(obj).filter(([k]) => !SKIP_FIELDS.has(k));
  if (entries.length === 0) return null;
  return (
    <div className="space-y-2">
      {entries.map(([key, value]) => (
        <div key={key}>
          <p className="text-xs font-semibold text-zinc-600 uppercase tracking-widest mb-0.5">{humanLabel(key)}</p>
          <ResultValue value={value} depth={depth} />
        </div>
      ))}
    </div>
  );
}

function TaskResultView({ result, agent }: { result: unknown; agent: string }) {
  if (result === null || result === undefined) return null;

  const r = result as Record<string, unknown>;

  // Decision agent: ranked options
  if (agent === 'decision' && Array.isArray(r['rankedOptions'])) {
    const options = r['rankedOptions'] as RankedOption[];
    return (
      <div className="space-y-2">
        {options.map((opt) => (
          <div key={opt.rank} className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-zinc-600">#{opt.rank}</span>
              <span className="text-sm font-medium text-zinc-200 flex-1">{opt.option}</span>
              <span className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 px-1.5 py-0.5 rounded-md font-medium shrink-0">
                {(opt.totalScore * 100).toFixed(0)}%
              </span>
            </div>
            {opt.strengths?.length > 0 && (
              <ul className="space-y-0.5">
                {opt.strengths.map((s, i) => (
                  <li key={i} className="text-xs text-zinc-400 flex gap-1.5">
                    <span className="text-emerald-500 shrink-0">+</span>{s}
                  </li>
                ))}
              </ul>
            )}
            {opt.weaknesses?.length > 0 && (
              <ul className="space-y-0.5">
                {opt.weaknesses.map((w, i) => (
                  <li key={i} className="text-xs text-zinc-500 flex gap-1.5">
                    <span className="text-zinc-600 shrink-0">–</span>{w}
                  </li>
                ))}
              </ul>
            )}
            {opt.risks?.length > 0 && (
              <ul className="space-y-0.5">
                {opt.risks.map((risk, i) => (
                  <li key={i} className="text-xs text-amber-400 flex gap-1.5">
                    <span className="shrink-0">!</span>{risk}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {typeof r['summary'] === 'string' && r['summary'] && (
          <p className="text-xs text-zinc-600 italic">{r['summary'] as string}</p>
        )}
      </div>
    );
  }

  // Comms agent: show draft prominently
  if (agent === 'comms' && typeof r['draft'] === 'string') {
    return (
      <div className="space-y-2">
        <p className="text-sm text-zinc-300 whitespace-pre-wrap border-l-2 border-zinc-700 pl-3">{r['draft'] as string}</p>
        {typeof r['notes'] === 'string' && r['notes'] && (
          <p className="text-xs text-zinc-500 italic">{r['notes'] as string}</p>
        )}
      </div>
    );
  }

  // Generic: render all top-level fields readably
  return <ResultObject obj={r} />;
}

// ── Summary card ───────────────────────────────────────────

function WorkflowSummaryCard({ tasks }: { tasks: TaskRow[] }) {
  const completedTasks = tasks.filter((t) => t.status === 'completed');
  if (completedTasks.length === 0) return null;

  // Decision task: render top recommendation with all alternatives below
  const decisionTask = completedTasks.find((t) => t.agent === 'decision');
  if (decisionTask?.result) {
    const result = decisionTask.result as Record<string, unknown>;
    const rankedOptions = result['rankedOptions'] as RankedOption[] | undefined;

    if (rankedOptions && rankedOptions.length > 0) {
      const top = rankedOptions[0];
      const rest = rankedOptions.slice(1);
      return (
        <div className="rounded-xl border border-indigo-500/25 bg-indigo-500/5 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-indigo-300">Recommendation</span>
            <span className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 px-2 py-0.5 rounded-md font-medium">
              Score: {(top.totalScore * 100).toFixed(0)}%
            </span>
          </div>
          <p className="text-sm font-medium text-zinc-100">{top.option}</p>
          {top.strengths?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-zinc-600 uppercase tracking-widest mb-1">Key strengths</p>
              <ul className="space-y-0.5">
                {top.strengths.slice(0, 3).map((s, i) => (
                  <li key={i} className="text-xs text-zinc-400 flex gap-1.5">
                    <span className="text-emerald-500 shrink-0">+</span>{s}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {top.risks?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-zinc-600 uppercase tracking-widest mb-1">Watch out for</p>
              <ul className="space-y-0.5">
                {top.risks.slice(0, 2).map((r, i) => (
                  <li key={i} className="text-xs text-zinc-400 flex gap-1.5">
                    <span className="text-amber-400 shrink-0">!</span>{r}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {rest.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-indigo-400 hover:text-indigo-300 font-medium select-none transition-colors">
                {rest.length} other option{rest.length > 1 ? 's' : ''} considered
              </summary>
              <div className="mt-2 space-y-2">
                {rest.map((opt) => (
                  <div key={opt.rank} className="bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-zinc-600">#{opt.rank}</span>
                      <span className="text-sm text-zinc-300 flex-1">{opt.option}</span>
                      <span className="text-xs bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded-md font-medium">
                        {(opt.totalScore * 100).toFixed(0)}%
                      </span>
                    </div>
                    {opt.weaknesses?.length > 0 && (
                      <ul className="space-y-0.5">
                        {opt.weaknesses.slice(0, 2).map((w, i) => (
                          <li key={i} className="text-xs text-zinc-500 flex gap-1.5">
                            <span className="text-zinc-600 shrink-0">–</span>{w}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      );
    }
  }

  // Fallback: look for a summary/recommendation/draft string in any completed task (last first)
  for (const task of [...completedTasks].reverse()) {
    const result = task.result as Record<string, unknown> | null;
    if (!result) continue;
    const text = result['summary'] ?? result['recommendation'] ?? result['draft'];
    if (typeof text === 'string' && text.length > 0) {
      return (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-xs font-semibold text-zinc-600 uppercase tracking-widest mb-1.5">Summary</p>
          <p className="text-sm text-zinc-300 whitespace-pre-wrap">{text}</p>
        </div>
      );
    }
  }

  return (
    <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3">
      <p className="text-sm text-emerald-300 font-medium">All {completedTasks.length} steps completed.</p>
    </div>
  );
}

interface WorkflowDashboardProps {
  refreshWorkflowId?: string | null;
}

export default function WorkflowDashboard({ refreshWorkflowId }: WorkflowDashboardProps) {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<WorkflowDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [taskStatuses, setTaskStatuses] = useState<Record<string, string>>({});
  const [sseConnected, setSseConnected] = useState(false);
  const [feedbackGiven, setFeedbackGiven] = useState<'positive' | 'negative' | null>(null);
  const esRef = useRef<EventSource | null>(null);

  // Fetch workflow list on mount
  useEffect(() => {
    fetch('/api/workflows')
      .then((r) => r.json() as Promise<{ ok: boolean; data: WorkflowSummary[] }>)
      .then((json) => { if (json.ok) setWorkflows(json.data); })
      .catch(() => { /* server may not be up */ })
      .finally(() => setLoadingList(false));
  }, []);

  // When Chat creates a new workflow: re-fetch the list and auto-select the new workflow.
  useEffect(() => {
    if (!refreshWorkflowId) return;
    fetch('/api/workflows')
      .then((r) => r.json() as Promise<{ ok: boolean; data: WorkflowSummary[] }>)
      .then((json) => {
        if (json.ok) {
          setWorkflows(json.data);
          setSelectedId(refreshWorkflowId);
        }
      })
      .catch(() => { /* ignore */ });
  }, [refreshWorkflowId]);

  // When a workflow is selected: fetch detail + open SSE
  useEffect(() => {
    if (!selectedId) return;

    // Close any existing SSE connection
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
      setSseConnected(false);
    }

    // Reset task status overlay and feedback
    setTaskStatuses({});
    setFeedbackGiven(null);
    setDetail(null);
    setLoadingDetail(true);

    // Fetch full detail (initial task list)
    fetch(`/api/workflows/${selectedId}`)
      .then((r) => r.json() as Promise<{ ok: boolean; data: WorkflowDetail }>)
      .then((json) => { if (json.ok) setDetail(json.data); })
      .catch(() => { /* ignore */ })
      .finally(() => setLoadingDetail(false));

    // Open SSE for live updates
    const es = new EventSource(`/api/workflows/${selectedId}/events`);
    esRef.current = es;

    es.onopen = () => setSseConnected(true);

    es.onmessage = (e: MessageEvent<string>) => {
      try {
        const event = JSON.parse(e.data) as TaskStatusEvent;
        setTaskStatuses((prev) => ({ ...prev, [event.taskId]: event.status }));
        // Also bump the status in the detail object so the badge stays consistent
        setDetail((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            tasks: prev.tasks.map((t) =>
              t.id === event.taskId ? { ...t, status: event.status } : t,
            ),
          };
        });
      } catch {
        // ping lines ("": "ping") or malformed — skip
      }
    };

    es.onerror = () => setSseConnected(false);

    return () => {
      es.close();
      esRef.current = null;
      setSseConnected(false);
    };
  }, [selectedId]);

  async function submitFeedback(rating: 'positive' | 'negative') {
    if (!selectedId || feedbackGiven) return;
    try {
      await fetch(`/api/workflows/${selectedId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ rating }),
      });
      setFeedbackGiven(rating);
    } catch {
      // non-fatal
    }
  }

  function refreshDetail() {
    if (!selectedId) return;
    setLoadingDetail(true);
    fetch(`/api/workflows/${selectedId}`)
      .then((r) => r.json() as Promise<{ ok: boolean; data: WorkflowDetail }>)
      .then((json) => { if (json.ok) setDetail(json.data); })
      .catch(() => { /* ignore */ })
      .finally(() => setLoadingDetail(false));
  }

  const effectiveStatus = (task: TaskRow) =>
    taskStatuses[task.id] ?? task.status;

  return (
    <div className="flex h-full">
      {/* Workflow list */}
      <div className="w-64 shrink-0 border-r border-zinc-800 flex flex-col">
        <div className="px-4 py-3.5 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-100">Workflows</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {loadingList && <p className="text-sm text-zinc-500 p-2">Loading…</p>}
          {!loadingList && workflows.length === 0 && (
            <p className="text-sm text-zinc-500 italic p-3">No workflows yet.</p>
          )}
          {[...workflows].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map((w) => (
            <button
              key={w.id}
              onClick={() => setSelectedId(w.id)}
              className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors ${
                selectedId === w.id
                  ? 'bg-indigo-500/10 border border-indigo-500/25'
                  : 'hover:bg-zinc-800/60 border border-transparent'
              }`}
            >
              <p className="text-sm font-medium text-zinc-200 truncate">{w.name}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span
                  className={`text-xs px-1.5 py-0.5 rounded-md font-medium ${
                    WORKFLOW_STATUS_COLOR[w.status] ?? 'bg-zinc-800 text-zinc-500'
                  }`}
                >
                  {w.status}
                </span>
                <span className="text-xs text-zinc-600">
                  {new Date(w.createdAt).toLocaleDateString()}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Task detail panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selectedId && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <p className="text-sm text-zinc-400">Select a workflow to view tasks.</p>
            </div>
          </div>
        )}

        {selectedId && (
          <>
            <div className="px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-zinc-100">
                  {detail?.name ?? 'Loading…'}
                </h3>
                {detail && (
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded-md font-medium ${
                      WORKFLOW_STATUS_COLOR[detail.status] ?? 'bg-zinc-800 text-zinc-500'
                    }`}
                  >
                    {detail.status}
                  </span>
                )}
                {sseConnected && (
                  <span className="flex items-center gap-1 text-xs text-emerald-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
                    Live
                  </span>
                )}
              </div>
              {/* Satisfaction feedback — only on completed workflows */}
              {detail?.status === 'completed' && (
                <div className="flex items-center gap-1">
                  {feedbackGiven == null ? (
                    <>
                      <span className="text-xs text-zinc-600 mr-0.5">Helpful?</span>
                      <button
                        onClick={() => void submitFeedback('positive')}
                        className="p-1 rounded-md hover:bg-emerald-500/10 text-zinc-600 hover:text-emerald-400 transition-colors"
                        title="Yes, helpful"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
                        </svg>
                      </button>
                      <button
                        onClick={() => void submitFeedback('negative')}
                        className="p-1 rounded-md hover:bg-red-500/10 text-zinc-600 hover:text-red-400 transition-colors"
                        title="Not helpful"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.736 3h4.018a2 2 0 01.485.06l3.76.94m-7 10v5a2 2 0 002 2h.096c.5 0 .905-.405.905-.904 0-.715.211-1.413.608-2.008L17 13V4m-7 10h2m5-10h2a2 2 0 012 2v6a2 2 0 01-2 2h-2.5" />
                        </svg>
                      </button>
                    </>
                  ) : (
                    <span className="text-xs text-zinc-600">Thanks for the feedback</span>
                  )}
                </div>
              )}
              <button
                onClick={refreshDetail}
                disabled={loadingDetail}
                className="text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-40 transition-colors"
              >
                Refresh
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
              {loadingDetail && <p className="text-sm text-zinc-500">Loading tasks…</p>}

              {!loadingDetail && detail && detail.tasks.length === 0 && (
                <p className="text-sm text-zinc-500 italic">No tasks found.</p>
              )}

              {detail?.status === 'completed' && detail.tasks.length > 0 && (
                <WorkflowSummaryCard tasks={detail.tasks} />
              )}

              {detail?.tasks.map((task, idx) => {
                const status = effectiveStatus(task);
                return (
                  <div
                    key={task.id}
                    className="rounded-xl border border-zinc-800 bg-zinc-900 p-3 space-y-1.5"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-zinc-600 w-4 shrink-0">{idx + 1}</span>
                      <span
                        className={`shrink-0 text-xs font-medium px-1.5 py-0.5 rounded-md capitalize ${
                          STATUS_COLOR[status] ?? 'bg-zinc-800 text-zinc-500'
                        }`}
                      >
                        {status.replace(/_/g, ' ')}
                      </span>
                      <span className="text-xs font-medium text-zinc-500 capitalize">{task.agent}</span>
                      <p className="flex-1 text-sm text-zinc-200 truncate">{task.action}</p>
                    </div>

                    {status === 'completed' && task.result != null && (
                      <details className="ml-6">
                        <summary className="cursor-pointer select-none text-xs text-zinc-500 hover:text-zinc-300 transition-colors">Result</summary>
                        <div className="mt-2">
                          <TaskResultView result={task.result} agent={task.agent} />
                        </div>
                      </details>
                    )}

                    {status === 'failed' && task.error && (
                      <p className="ml-6 text-xs text-red-400">{task.error}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
