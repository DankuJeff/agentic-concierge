import { useEffect, useRef, useState } from 'react';

// Maximum number of clarification Q&A rounds before the Conductor is forced to decompose.
const MAX_CLARIFICATION_ROUNDS = 3;
const CHAT_STORAGE_KEY = 'concierge-chat-messages';
const SESSIONS_STORAGE_KEY = 'concierge-chat-sessions';

interface PlanStep {
  id: string;
  agent: string;
  action: string;
  autonomy: number;
}

interface AttachedFile {
  filename: string;
  mimeType: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  workflowId?: string;
  plan?: PlanStep[];
  isClarification?: boolean;
  isFinalReport?: boolean;
  attachments?: AttachedFile[];
}

interface TaskStatusEvent {
  workflowId: string;
  taskId: string;
  agent: string;
  status: string;
}

interface ClarificationRound {
  question: string;
  answer: string;
}

interface ClarificationState {
  originalRequest: string;
  rounds: ClarificationRound[];
  pendingQuestion: string;
}

interface ConversationSession {
  id: string;           // workflowId
  name: string;         // truncated original request
  timestamp: string;
  messages: Message[];
}

// ── Task result types (for final report synthesis) ─────────
interface RankedOption {
  rank: number;
  option: string;
  strengths: string[];
  weaknesses: string[];
  risks: string[];
  totalScore: number;
}

interface TaskRow {
  id: string;
  agent: string;
  action: string;
  status: string;
  result: unknown;
  error: string | null;
}

// SSE stays open through awaiting_user so post-approval status changes are received
const TERMINAL_STATUSES = new Set([
  'completed', 'failed', 'skipped', 'awaiting_recovery',
]);
// awaiting_user is a pause state, not terminal — SSE must remain open

const AUTONOMY_LABEL: Record<number, string> = { 1: 'Auto', 2: 'Approve', 3: 'Confirm' };
const AUTONOMY_COLOR: Record<number, string> = {
  1: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25',
  2: 'bg-amber-500/10 text-amber-400 border border-amber-500/25',
  3: 'bg-red-500/10 text-red-400 border border-red-500/25',
};
const AGENT_COLOR: Record<string, string> = {
  research: 'bg-blue-500/10 text-blue-400 border border-blue-500/25',
  document: 'bg-purple-500/10 text-purple-400 border border-purple-500/25',
  comms: 'bg-pink-500/10 text-pink-400 border border-pink-500/25',
  decision: 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/25',
  finance: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25',
};

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'running':
      return (
        <span className="w-4 h-4 shrink-0 flex items-center justify-center">
          <span className="w-3 h-3 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin inline-block" />
        </span>
      );
    case 'completed':
      return <span className="w-4 shrink-0 text-center text-emerald-400 font-bold text-xs">✓</span>;
    case 'failed':
    case 'awaiting_recovery':
      return <span className="w-4 shrink-0 text-center text-red-400 font-bold text-xs">✗</span>;
    case 'awaiting_user':
      return <span className="w-4 shrink-0 text-center text-amber-400 text-xs">⏸</span>;
    case 'skipped':
      return <span className="w-4 shrink-0 text-center text-zinc-600 text-xs">–</span>;
    default:
      return <span className="w-4 shrink-0 text-center text-zinc-700 text-xs">·</span>;
  }
}

// ── Final report synthesis ─────────────────────────────────

function buildFinalReport(tasks: TaskRow[]): string {
  const completed = tasks.filter((t) => t.status === 'completed');
  const failed = tasks.filter((t) => t.status === 'failed' || t.status === 'awaiting_recovery');

  const lines: string[] = [];

  // Decision task → recommendation
  const decisionTask = completed.find((t) => t.agent === 'decision');
  if (decisionTask?.result) {
    const r = decisionTask.result as Record<string, unknown>;
    const rankedOptions = r['rankedOptions'] as RankedOption[] | undefined;
    if (rankedOptions && rankedOptions.length > 0) {
      const top = rankedOptions[0];
      lines.push(`Recommendation: ${top.option} (Score: ${(top.totalScore * 100).toFixed(0)}%)`);
      if (top.strengths?.length) {
        lines.push('');
        lines.push('Key strengths:');
        top.strengths.slice(0, 3).forEach((s) => lines.push(`  + ${s}`));
      }
      if (top.risks?.length) {
        lines.push('');
        lines.push('Watch out for:');
        top.risks.slice(0, 2).forEach((r) => lines.push(`  ! ${r}`));
      }
      if (rankedOptions.length > 1) {
        lines.push('');
        lines.push(`${rankedOptions.length - 1} other option${rankedOptions.length > 2 ? 's' : ''} were evaluated — open the Workflows tab for the full comparison.`);
      }
      return lines.join('\n');
    }
    if (typeof r['summary'] === 'string' && r['summary']) {
      return r['summary'] as string;
    }
  }

  // Comms task → draft (may be in r.draft, r.communications[0].body, or r.communications[0].content)
  const commsTask = completed.find((t) => t.agent === 'comms');
  if (commsTask?.result) {
    const r = commsTask.result as Record<string, unknown>;
    // Resolve draft text from various possible shapes
    let draftText: string | undefined;
    if (typeof r['draft'] === 'string' && r['draft']) {
      draftText = r['draft'] as string;
    } else if (Array.isArray(r['communications']) && r['communications'].length > 0) {
      const first = r['communications'][0] as Record<string, unknown>;
      draftText = (first['body'] ?? first['content'] ?? first['text']) as string | undefined;
    }
    if (draftText) {
      if (typeof r['summary'] === 'string' && r['summary']) {
        lines.push(r['summary'] as string);
        lines.push('');
      }
      lines.push(draftText);
      if (typeof r['notes'] === 'string' && r['notes']) {
        lines.push('');
        lines.push(`Note: ${r['notes'] as string}`);
      }
      return lines.join('\n');
    }
  }

  // Document task → summary + flags + action items
  const documentTask = completed.find((t) => t.agent === 'document');
  if (documentTask?.result) {
    const r = documentTask.result as Record<string, unknown>;
    const extracted = r['extracted_data'] as Record<string, unknown> | undefined;

    if (typeof r['summary'] === 'string' && r['summary']) {
      lines.push(r['summary'] as string);

      // Surface flags from extracted_data (keyed flag_1, flag_2, …)
      if (extracted) {
        const flagEntries = Object.entries(extracted)
          .filter(([k]) => /^flag_\d+$/.test(k))
          .map(([, v]) => v as string);
        if (flagEntries.length > 0) {
          lines.push('');
          lines.push(`${flagEntries.length} item${flagEntries.length > 1 ? 's' : ''} flagged:`);
          flagEntries.forEach((f) => {
            // Each flag is "TITLE — description". Bold the title part in the chat.
            const dashIdx = f.indexOf(' — ');
            const title = dashIdx > -1 ? f.slice(0, dashIdx) : f;
            const body = dashIdx > -1 ? f.slice(dashIdx + 3) : '';
            lines.push(`\n• ${title}${body ? `\n  ${body}` : ''}`);
          });
        }

        // Surface action items if present
        const actionItems = extracted['action_items_for_tyler'] as string[] | undefined
          ?? (r['action_items'] as string[] | undefined);
        if (actionItems && actionItems.length > 0) {
          lines.push('');
          lines.push('What to do:');
          actionItems.slice(0, 5).forEach((a) => lines.push(`  ${a}`));
          if (actionItems.length > 5) lines.push(`  …and ${actionItems.length - 5} more — see Workflows tab.`);
        }
      }

      return lines.join('\n');
    }
  }

  // Generic fallback: find any summary/recommendation string
  for (const task of [...completed].reverse()) {
    const r = task.result as Record<string, unknown> | null;
    if (!r) continue;
    const text = r['summary'] ?? r['recommendation'] ?? r['analysis'];
    if (typeof text === 'string' && text.length > 0) return text as string;
  }

  if (failed.length > 0) {
    return `Workflow completed with ${failed.length} step${failed.length > 1 ? 's' : ''} that could not finish. Check the Workflows tab for details.`;
  }

  return `All ${completed.length} steps completed. Open the Workflows tab to review the full results.`;
}

// ── Context stitching ──────────────────────────────────────

function buildStitchedMessage(
  originalRequest: string,
  completedRounds: ClarificationRound[],
  forceDecompose: boolean,
): string {
  const lines: string[] = [
    `User request: ${originalRequest}`,
    '',
    '=== CLARIFICATION CONTEXT ===',
  ];

  completedRounds.forEach((r, i) => {
    lines.push(`Round ${i + 1}:`);
    lines.push(`Q: ${r.question}`);
    lines.push(`A: ${r.answer}`);
    if (i < completedRounds.length - 1) lines.push('');
  });

  if (forceDecompose) {
    lines.push('');
    lines.push('[FORCE DECOMPOSE] Maximum clarification rounds reached. Decompose now with all available context. Note any remaining unknowns in the relevant task inputs as a "note" field.');
  }

  return lines.join('\n');
}

// ── Component ──────────────────────────────────────────────

interface ChatProps {
  onWorkflowCreated?: (workflowId: string) => void;
}

export default function Chat({ onWorkflowCreated }: ChatProps) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      const saved = localStorage.getItem(CHAT_STORAGE_KEY);
      return saved ? (JSON.parse(saved) as Message[]) : [];
    } catch {
      return [];
    }
  });
  const [sessions, setSessions] = useState<ConversationSession[]>(() => {
    try {
      const saved = localStorage.getItem(SESSIONS_STORAGE_KEY);
      return saved ? (JSON.parse(saved) as ConversationSession[]) : [];
    } catch {
      return [];
    }
  });
  const [viewingSession, setViewingSession] = useState<ConversationSession | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sseActive, setSseActive] = useState(false);
  const [clarificationState, setClarificationState] = useState<ClarificationState | null>(null);
  const [liveStatuses, setLiveStatuses] = useState<Record<string, Record<string, string>>>({});

  const [pendingAttachments, setPendingAttachments] = useState<File[]>([]);

  const esRef = useRef<EventSource | null>(null);
  const activePlanRef = useRef<{ workflowId: string; stepIds: string[] } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Persist messages to localStorage + scroll to bottom on new messages
  useEffect(() => {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages));
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Persist sessions to localStorage
  useEffect(() => {
    localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
  }, [sessions]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close SSE once all steps reach a terminal state, then fetch and append final report
  useEffect(() => {
    if (!activePlanRef.current || !esRef.current) return;
    const { workflowId, stepIds } = activePlanRef.current;
    const wfStatuses = liveStatuses[workflowId] ?? {};
    const allDone =
      stepIds.length > 0 &&
      stepIds.every((id) => TERMINAL_STATUSES.has(wfStatuses[id] ?? ''));
    if (allDone) {
      esRef.current.close();
      esRef.current = null;
      activePlanRef.current = null;
      setSseActive(false);
      void fetchAndAppendFinalReport(workflowId);
    }
  }, [liveStatuses]);

  // Polling fallback: when SSE is closed but a workflow still has non-terminal steps
  // (e.g. user approved a task after SSE disconnected), poll the workflow API every 5s
  // to pick up status changes and eventually trigger fetchAndAppendFinalReport.
  useEffect(() => {
    if (sseActive || !activePlanRef.current) {
      // SSE is active or no active plan — stop polling
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    const { workflowId, stepIds } = activePlanRef.current;
    if (pollRef.current) return; // already polling
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/workflows/${workflowId}`);
        const json = await res.json() as { ok: boolean; data?: { tasks: Array<{ id: string; status: string }> } };
        if (!json.ok || !json.data) return;
        const statusMap: Record<string, string> = {};
        for (const t of json.data.tasks) statusMap[t.id] = t.status;
        setLiveStatuses((prev) => ({ ...prev, [workflowId]: { ...(prev[workflowId] ?? {}), ...statusMap } }));
        // Stop polling once all steps are terminal
        const allDone = stepIds.every((id) => TERMINAL_STATUSES.has(statusMap[id] ?? ''));
        if (allDone && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
          activePlanRef.current = null;
        }
      } catch { /* ignore */ }
    }, 5_000);
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [sseActive]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      esRef.current?.close();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function fetchAndAppendFinalReport(workflowId: string) {
    try {
      const res = await fetch(`/api/workflows/${workflowId}`);
      const json = await res.json() as { ok: boolean; data?: { tasks: TaskRow[] } };
      if (!json.ok || !json.data) return;

      const reportText = buildFinalReport(json.data.tasks);
      const reportMessage: Message = {
        role: 'assistant',
        content: reportText,
        workflowId,
        isFinalReport: true,
      };

      setMessages((prev) => {
        const updated = [...prev, reportMessage];
        // Save as a named session
        const userMessages = prev.filter((m) => m.role === 'user');
        const originalRequest = userMessages[userMessages.length - 1]?.content ?? 'Conversation';
        const session: ConversationSession = {
          id: workflowId,
          name: originalRequest.slice(0, 80),
          timestamp: new Date().toISOString(),
          messages: updated,
        };
        setSessions((prevSessions) => {
          const filtered = prevSessions.filter((s) => s.id !== workflowId);
          return [session, ...filtered].slice(0, 20); // keep last 20 sessions
        });
        return updated;
      });
    } catch {
      // non-critical — workflow tab still has the data
    }
  }

  function openSSE(workflowId: string, plan: PlanStep[]) {
    esRef.current?.close();
    esRef.current = null;
    setSseActive(false);

    const stepIds = plan.map((s) => `${workflowId}:${s.id}`);
    activePlanRef.current = { workflowId, stepIds };

    const es = new EventSource(`/api/workflows/${workflowId}/events`);
    esRef.current = es;

    es.onopen = () => setSseActive(true);

    es.onmessage = (e: MessageEvent<string>) => {
      try {
        const event = JSON.parse(e.data) as TaskStatusEvent;
        setLiveStatuses((prev) => ({
          ...prev,
          [event.workflowId]: {
            ...(prev[event.workflowId] ?? {}),
            [event.taskId]: event.status,
          },
        }));
      } catch {
        // ping lines or malformed — skip
      }
    };

    es.onerror = () => {
      es.close();
      esRef.current = null;
      setSseActive(false);
      activePlanRef.current = null;
    };
  }

  function startNewChat() {
    // Save current conversation as a session if it has messages
    if (messages.length > 0) {
      const userMessages = messages.filter((m) => m.role === 'user');
      const name = userMessages[0]?.content ?? 'Conversation';
      const existing = sessions.find((s) => s.messages === messages);
      if (!existing) {
        const session: ConversationSession = {
          id: `manual-${Date.now()}`,
          name: name.slice(0, 80),
          timestamp: new Date().toISOString(),
          messages: [...messages],
        };
        setSessions((prev) => [session, ...prev].slice(0, 20));
      }
    }
    setMessages([]);
    setClarificationState(null);
    setPendingAttachments([]);
    setInput('');
    setViewingSession(null);
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify([]));
  }

  function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  async function uploadFiles(files: File[]): Promise<AttachedFile[]> {
    const uploaded: AttachedFile[] = [];
    for (const file of files) {
      const buffer = await file.arrayBuffer();
      const base64 = arrayBufferToBase64(buffer);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout
      let res: Response;
      try {
        res = await fetch('/api/documents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name, mimeType: file.type, content: base64 }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      if (res.ok) {
        uploaded.push({ filename: file.name, mimeType: file.type });
      } else {
        const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(`Failed to upload ${file.name}: ${body.error?.message ?? res.statusText}`);
      }
    }
    return uploaded;
  }

  async function sendToApi(message: string) {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    return res.json() as Promise<{
      ok: boolean;
      data?:
        | { type: 'plan'; workflowId: string; plan: PlanStep[] }
        | { type: 'clarification'; question: string };
      error?: { message: string };
    }>;
  }

  async function handleSubmit() {
    const text = input.trim();
    if (!text) return; // always require a message — files alone give the Conductor no instruction
    if (loading) return;
    setInput('');
    setLoading(true);
    if (viewingSession) setViewingSession(null);

    let uploadedFiles: AttachedFile[] = [];
    let fullText = text;

    try {
      // Upload any pending files first
      if (pendingAttachments.length > 0) {
        uploadedFiles = await uploadFiles(pendingAttachments);
        setPendingAttachments([]);
        fullText = text + `\n[Files uploaded to document vault: ${uploadedFiles.map((f) => f.filename).join(', ')}]`;
      }
    } catch (uploadErr) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `File upload failed: ${uploadErr instanceof Error ? uploadErr.message : String(uploadErr)}` },
      ]);
      setLoading(false);
      return;
    }

    setMessages((prev) => [...prev, {
      role: 'user',
      content: text,
      attachments: uploadedFiles.length > 0 ? uploadedFiles : undefined,
    }]);

    try {
      let messageToSend: string;
      let nextRounds: ClarificationRound[] = [];
      let isForced = false;

      if (clarificationState) {
        nextRounds = [
          ...clarificationState.rounds,
          { question: clarificationState.pendingQuestion, answer: fullText },
        ];
        isForced = nextRounds.length >= MAX_CLARIFICATION_ROUNDS;
        messageToSend = buildStitchedMessage(
          clarificationState.originalRequest,
          nextRounds,
          isForced,
        );
      } else {
        messageToSend = fullText;
      }

      const json = await sendToApi(messageToSend);

      if (!json.ok || !json.data) {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: json.error?.message ?? 'Something went wrong.' },
        ]);
        setClarificationState(null);
        return;
      }

      if (json.data.type === 'clarification') {
        const { question } = json.data;
        if (clarificationState) {
          setClarificationState({ ...clarificationState, rounds: nextRounds, pendingQuestion: question });
        } else {
          setClarificationState({ originalRequest: text, rounds: [], pendingQuestion: question });
        }

        const roundsCompleted = clarificationState ? nextRounds.length : 0;
        const roundLabel = roundsCompleted > 0 ? ` (${roundsCompleted}/${MAX_CLARIFICATION_ROUNDS})` : '';

        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: question + roundLabel, isClarification: true },
        ]);
      } else {
        const { workflowId, plan } = json.data;
        setClarificationState(null);

        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: `Workflow started — ${plan.length} step${plan.length !== 1 ? 's' : ''} planned.`,
            workflowId,
            plan,
          },
        ]);
        openSSE(workflowId, plan);
        onWorkflowCreated?.(workflowId);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Failed to reach server.' },
      ]);
      setClarificationState(null);
    } finally {
      setLoading(false);
    }
  }

  function getStepStatus(workflowId: string, stepId: string): string {
    return liveStatuses[workflowId]?.[`${workflowId}:${stepId}`] ?? 'pending';
  }

  function getPlanHeaderLabel(workflowId: string, plan: PlanStep[]): string {
    const statuses = plan.map((s) => getStepStatus(workflowId, s.id));
    if (statuses.every((s) => s === 'completed' || s === 'skipped')) return 'Completed';
    if (statuses.some((s) => s === 'failed' || s === 'awaiting_recovery')) return 'Failed';
    if (statuses.some((s) => s === 'awaiting_user')) return 'Awaiting approval';
    if (statuses.some((s) => s === 'running')) return 'Running…';
    if (statuses.some((s) => s !== 'pending')) return 'In progress…';
    return 'Pending';
  }

  const inClarification = clarificationState !== null;
  const roundsUsed = clarificationState?.rounds.length ?? 0;
  const displayMessages = viewingSession ? viewingSession.messages : messages;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {viewingSession ? (
            <button
              onClick={() => setViewingSession(null)}
              className="text-xs text-indigo-400 hover:text-indigo-300 font-medium transition-colors"
            >
              ← Back to current
            </button>
          ) : (
            <h2 className="text-sm font-semibold text-zinc-100">Chat</h2>
          )}
          {viewingSession && (
            <span className="text-sm text-zinc-500 truncate max-w-xs">{viewingSession.name}</span>
          )}
          {!viewingSession && (
            <button
              onClick={startNewChat}
              title="New chat"
              className="w-6 h-6 flex items-center justify-center rounded-full border border-zinc-700 text-zinc-500 hover:border-indigo-500 hover:text-indigo-400 transition-colors text-sm font-bold leading-none"
            >
              +
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          {inClarification && !viewingSession && (
            <span className="text-xs text-amber-400 font-medium">
              Clarifying ({roundsUsed}/{MAX_CLARIFICATION_ROUNDS})
            </span>
          )}
          {sseActive && !viewingSession && (
            <span className="flex items-center gap-1.5 text-xs text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
              Live
            </span>
          )}

          {/* Recent Conversations dropdown */}
          {sessions.length > 0 && (
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setShowDropdown((v) => !v)}
                className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 font-medium border border-zinc-700 hover:border-zinc-600 rounded-md px-2.5 py-1 transition-colors"
              >
                Recent
                <span className="bg-zinc-800 text-zinc-400 rounded px-1 text-xs font-bold">{sessions.length}</span>
                <span className="text-zinc-600">{showDropdown ? '▲' : '▼'}</span>
              </button>

              {showDropdown && (
                <div className="absolute right-0 top-8 z-10 w-72 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden">
                  <div className="px-3 py-2 border-b border-zinc-800">
                    <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Recent Conversations</span>
                  </div>
                  <ul className="max-h-64 overflow-y-auto divide-y divide-zinc-800/60">
                    {sessions.map((s) => (
                      <li key={s.id}>
                        <button
                          onClick={() => { setViewingSession(s); setShowDropdown(false); }}
                          className="w-full text-left px-3 py-2.5 hover:bg-zinc-800/60 transition-colors"
                        >
                          <p className="text-sm text-zinc-200 truncate">{s.name}</p>
                          <p className="text-xs text-zinc-600 mt-0.5">
                            {new Date(s.timestamp).toLocaleDateString()} · {new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
        {displayMessages.length === 0 && (
          <div className="space-y-5 py-8">
            <div className="text-center">
              <p className="text-sm font-medium text-zinc-300 mb-1">What do you need done?</p>
              <p className="text-xs text-zinc-600">Describe any multi-step task — Concierge handles the rest.</p>
            </div>
            <div className="grid grid-cols-1 gap-2 max-w-lg mx-auto">
              {[
                'Compare internet providers in my area and find a better deal',
                'Audit my subscriptions and identify which ones I should cancel',
                'Review this contract and flag anything I should know about',
                'Dispute the charge on my last phone bill',
                'Find a better home insurance rate and draft the switch request',
              ].map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => setInput(prompt)}
                  className="text-left text-sm text-zinc-400 hover:text-zinc-200 bg-zinc-900 hover:bg-zinc-800/80 border border-zinc-800 hover:border-zinc-700 rounded-xl px-4 py-3 transition-all duration-150 flex items-center justify-between group"
                >
                  <span>{prompt}</span>
                  <svg className="w-3.5 h-3.5 text-zinc-700 group-hover:text-indigo-400 shrink-0 ml-3 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              ))}
            </div>
          </div>
        )}

        {displayMessages.map((m, i) => (
          <div key={i} className={`flex flex-col gap-2 ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
            <div
              className={`text-sm px-4 py-2.5 rounded-xl max-w-prose whitespace-pre-wrap leading-relaxed ${
                m.role === 'user'
                  ? 'bg-indigo-600 text-white'
                  : m.isClarification
                    ? 'bg-amber-500/10 text-amber-200 border border-amber-500/25'
                    : m.isFinalReport
                      ? 'bg-emerald-500/10 text-emerald-200 border border-emerald-500/25'
                      : 'bg-zinc-800 text-zinc-200'
              }`}
            >
              {m.isFinalReport && (
                <p className="text-xs font-semibold text-emerald-400 uppercase tracking-widest mb-2">Final Report</p>
              )}
              {m.isClarification && (
                <p className="text-xs font-semibold text-amber-400 uppercase tracking-widest mb-2">Clarification needed</p>
              )}
              {m.content}
              {m.workflowId && !m.isClarification && !m.isFinalReport && (
                <span className="ml-2 text-xs text-zinc-600 font-mono">{m.workflowId.slice(0, 8)}</span>
              )}
            </div>

            {m.attachments && m.attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1">
                {m.attachments.map((f, fi) => (
                  <span key={fi} className="flex items-center gap-1 text-xs bg-zinc-800 border border-zinc-700 text-zinc-400 px-2 py-1 rounded-md">
                    <span>📎</span>
                    {f.filename}
                  </span>
                ))}
              </div>
            )}

            {m.plan && m.plan.length > 0 && m.workflowId && (
              <div className="w-full max-w-2xl border border-zinc-800 rounded-xl overflow-hidden">
                <div className="bg-zinc-900 px-4 py-2.5 border-b border-zinc-800 flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">Workflow Plan</span>
                  <span className="text-xs text-zinc-500">{getPlanHeaderLabel(m.workflowId, m.plan)}</span>
                </div>
                <ul className="divide-y divide-zinc-800/60">
                  {m.plan.map((step) => {
                    const status = getStepStatus(m.workflowId!, step.id);
                    return (
                      <li
                        key={step.id}
                        className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${
                          status === 'running' ? 'bg-indigo-500/5' :
                          status === 'completed' ? 'bg-emerald-500/5' :
                          status === 'failed' || status === 'awaiting_recovery' ? 'bg-red-500/5' :
                          status === 'awaiting_user' ? 'bg-amber-500/5' :
                          'bg-zinc-900'
                        }`}
                      >
                        <StatusIcon status={status} />
                        <span className={`shrink-0 text-xs font-medium px-1.5 py-0.5 rounded-md capitalize ${AGENT_COLOR[step.agent] ?? 'bg-zinc-800 text-zinc-400'}`}>
                          {step.agent}
                        </span>
                        <span className="flex-1 text-sm text-zinc-300">{step.action}</span>
                        <span className={`shrink-0 text-xs font-medium px-1.5 py-0.5 rounded-md ${AUTONOMY_COLOR[step.autonomy] ?? 'bg-zinc-800 text-zinc-400'}`}>
                          L{step.autonomy} {AUTONOMY_LABEL[step.autonomy]}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex items-start">
            <div className="bg-zinc-800 text-zinc-400 text-sm px-4 py-2.5 rounded-xl animate-pulse flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-ping inline-block" />
              {inClarification ? 'Processing your answer…' : 'Conductor is planning…'}
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input — hidden when viewing a past session */}
      {!viewingSession && (
        <div className="px-5 py-4 border-t border-zinc-800 space-y-2">
          {/* Pending attachment badges */}
          {pendingAttachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {pendingAttachments.map((f, i) => (
                <span key={i} className="flex items-center gap-1 text-xs bg-indigo-500/10 border border-indigo-500/25 text-indigo-300 px-2 py-1 rounded-md">
                  <span>📎</span>
                  {f.name}
                  <button
                    onClick={() => setPendingAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                    className="ml-0.5 text-indigo-400 hover:text-indigo-200 transition-colors"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length > 0) setPendingAttachments((prev) => [...prev, ...files]);
                e.target.value = '';
              }}
            />
            {/* Paperclip button */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              title="Attach file"
              className="shrink-0 w-10 h-auto flex items-center justify-center rounded-xl border border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600 disabled:opacity-40 transition-colors text-base"
            >
              📎
            </button>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSubmit();
                }
              }}
              placeholder={inClarification ? 'Type your answer…' : 'What do you need done?'}
              disabled={loading}
              rows={3}
              className={`input-dark flex-1 rounded-xl px-4 py-2.5 text-sm disabled:opacity-50 resize-none ${
                inClarification ? 'border-amber-500/50 focus:border-amber-500 focus:shadow-none' : ''
              }`}
            />
            <button
              onClick={() => void handleSubmit()}
              disabled={loading || (input.trim() === '' && pendingAttachments.length === 0)}
              className="btn-glow shrink-0 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 transition-colors duration-150"
            >
              {loading ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
