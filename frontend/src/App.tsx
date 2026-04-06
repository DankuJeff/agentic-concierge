import { useState, useEffect, useCallback } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import Chat from './components/Chat';
import WorkflowDashboard from './components/WorkflowDashboard';
import ApprovalQueue from './components/ApprovalQueue';
import AnalyticsDashboard from './components/AnalyticsDashboard';
import DocumentVault from './components/DocumentVault';
import LandingPage from './components/LandingPage';

type View = 'chat' | 'workflows' | 'approvals' | 'documents' | 'analytics';

interface NavItem { id: View; label: string; icon: React.ReactNode }

function IconChat() {
  return (
    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  );
}
function IconWorkflows() {
  return (
    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  );
}
function IconApprovals() {
  return (
    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  );
}
function IconDocuments() {
  return (
    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}
function IconAnalytics() {
  return (
    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  );
}
function IconLogout() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
    </svg>
  );
}

const NAV: NavItem[] = [
  { id: 'chat',      label: 'Chat',      icon: <IconChat /> },
  { id: 'workflows', label: 'Workflows', icon: <IconWorkflows /> },
  { id: 'approvals', label: 'Approvals', icon: <IconApprovals /> },
  { id: 'documents', label: 'Documents', icon: <IconDocuments /> },
  { id: 'analytics', label: 'Analytics', icon: <IconAnalytics /> },
];

interface AuthUser { id: string; name: string; email: string }
interface IntegrationStatus { gmail: { connected: boolean }; calendar: { connected: boolean } }
interface BillingStatus { status: string | null; isActive: boolean }
interface PlaidStatus { connected: boolean }

export default function App() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [view, setView] = useState<View>('chat');
  const [lastWorkflowId, setLastWorkflowId] = useState<string | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationStatus | null>(null);
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [plaid, setPlaid] = useState<PlaidStatus | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState(0);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() as Promise<{ ok: true; data: AuthUser }> : null))
      .then((json) => setAuthUser(json?.data ?? null))
      .catch(() => setAuthUser(null))
      .finally(() => setAuthChecked(true));
  }, []);

  useEffect(() => {
    if (!authUser) return;
    fetch('/api/integrations/google/status', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => { if (json?.ok) setIntegrations(json.data as IntegrationStatus); })
      .catch(() => null);
    fetch('/api/billing/status', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => { if (json?.ok) setBilling(json.data as BillingStatus); })
      .catch(() => null);
    fetch('/api/plaid/status', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => { if (json?.ok) setPlaid(json.data as PlaidStatus); })
      .catch(() => null);
  }, [authUser]);

  useEffect(() => {
    if (!authUser) return;
    function fetchCount() {
      fetch('/api/tasks/pending-approval', { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : null))
        .then((json: { ok: boolean; data: unknown[] } | null) => {
          if (json?.ok) setPendingApprovals(json.data.length);
        })
        .catch(() => null);
    }
    fetchCount();
    const interval = setInterval(fetchCount, 10_000);
    return () => clearInterval(interval);
  }, [authUser]);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    setAuthUser(null);
  };

  if (!authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#09090b]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center animate-pulse">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <p className="text-xs text-zinc-600">Loading…</p>
        </div>
      </div>
    );
  }

  const urlError = new URLSearchParams(window.location.search).get('error');
  if (!authUser) return <LandingPage error={urlError} />;

  const initials = authUser.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="flex h-screen bg-[#09090b] text-zinc-100">
      {/* Sidebar */}
      <nav className="w-56 shrink-0 bg-[#0f0f13] border-r border-zinc-800 flex flex-col">
        {/* Logo */}
        <div className="px-4 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center shrink-0">
              <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <span className="text-sm font-semibold text-zinc-100 tracking-tight">Concierge</span>
          </div>
        </div>

        {/* Nav */}
        <ul className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {NAV.map(({ id, label, icon }) => (
            <li key={id}>
              <button
                onClick={() => setView(id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
                  view === id
                    ? 'nav-active'
                    : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/50'
                }`}
              >
                {icon}
                <span className="flex-1 text-left">{label}</span>
                {id === 'approvals' && pendingApprovals > 0 && (
                  <span className="bg-indigo-600 text-white text-[10px] font-bold rounded-full min-w-[1.1rem] h-[1.1rem] flex items-center justify-center px-1 leading-none">
                    {pendingApprovals}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>

        {/* Integrations */}
        <div className="px-3 py-3 border-t border-zinc-800 space-y-2">
          {integrations && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-widest">Integrations</p>
              <IntegrationDot label="Gmail" connected={integrations.gmail.connected} href="/api/auth/google" />
              <IntegrationDot label="Calendar" connected={integrations.calendar.connected} href="/api/auth/google" />
              {plaid !== null && (
                <PlaidDot
                  connected={plaid.connected}
                  onConnected={() => setPlaid({ connected: true })}
                />
              )}
              {billing !== null && (
                <BillingDot status={billing.status} isActive={billing.isActive} />
              )}
            </div>
          )}
        </div>

        {/* User */}
        <div className="px-3 py-3 border-t border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-[10px] font-bold text-white shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-zinc-200 truncate">{authUser.name}</p>
              <p className="text-[10px] text-zinc-600 truncate">{authUser.email}</p>
            </div>
            <button
              onClick={() => void handleLogout()}
              title="Sign out"
              className="text-zinc-600 hover:text-zinc-300 transition-colors p-0.5"
            >
              <IconLogout />
            </button>
          </div>
        </div>
      </nav>

      {/* Main */}
      <main className="flex-1 overflow-hidden">
        <div className={view === 'chat'      ? 'h-full' : 'hidden'}><Chat onWorkflowCreated={setLastWorkflowId} /></div>
        <div className={view === 'workflows' ? 'h-full' : 'hidden'}><WorkflowDashboard refreshWorkflowId={lastWorkflowId} /></div>
        <div className={view === 'approvals' ? 'h-full' : 'hidden'}><ApprovalQueue /></div>
        <div className={view === 'documents' ? 'h-full' : 'hidden'}><DocumentVault /></div>
        <div className={view === 'analytics' ? 'h-full' : 'hidden'}><AnalyticsDashboard /></div>
      </main>
    </div>
  );
}

/* ── Compact sidebar sub-components ─────────────────────── */

function IntegrationDot({ label, connected, href }: { label: string; connected: boolean; href: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${connected ? 'bg-emerald-500' : 'bg-zinc-700'}`} />
      <span className="text-xs text-zinc-500 flex-1">{label}</span>
      {!connected && (
        <a href={href} className="text-[10px] text-indigo-400 hover:text-indigo-300 transition-colors">Connect</a>
      )}
    </div>
  );
}

function PlaidDot({ connected, onConnected }: { connected: boolean; onConnected: () => void }) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);

  const onSuccess = useCallback(async (publicToken: string) => {
    try {
      await fetch('/api/plaid/exchange-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ publicToken }),
      });
      onConnected();
    } catch { /* non-fatal */ }
  }, [onConnected]);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: (pub) => void onSuccess(pub),
  });

  useEffect(() => { if (linkToken && ready) open(); }, [linkToken, ready, open]);

  const handleConnect = async () => {
    if (linkToken && ready) { open(); return; }
    setFetching(true);
    try {
      const res = await fetch('/api/plaid/link-token', { method: 'POST', credentials: 'include' });
      const json = await res.json() as { ok: boolean; data?: { linkToken: string } };
      if (json.ok && json.data?.linkToken) setLinkToken(json.data.linkToken);
    } finally { setFetching(false); }
  };

  return (
    <div className="flex items-center gap-2">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${connected ? 'bg-emerald-500' : 'bg-zinc-700'}`} />
      <span className="text-xs text-zinc-500 flex-1">Bank</span>
      {!connected && (
        <button onClick={() => void handleConnect()} disabled={fetching} className="text-[10px] text-indigo-400 hover:text-indigo-300 transition-colors disabled:opacity-40">
          {fetching ? '…' : 'Connect'}
        </button>
      )}
    </div>
  );
}

function BillingDot({ status, isActive }: { status: string | null; isActive: boolean }) {
  const handleSubscribe = async () => {
    const res = await fetch('/api/billing/create-checkout-session', { method: 'POST', credentials: 'include' });
    const json = await res.json() as { ok: boolean; data?: { url: string } };
    if (json.ok && json.data?.url) window.location.href = json.data.url;
  };
  const handleManage = async () => {
    const res = await fetch('/api/billing/create-portal-session', { method: 'POST', credentials: 'include' });
    const json = await res.json() as { ok: boolean; data?: { url: string } };
    if (json.ok && json.data?.url) window.location.href = json.data.url;
  };
  const dot = isActive ? 'bg-emerald-500' : status === 'past_due' ? 'bg-amber-500' : 'bg-zinc-700';

  return (
    <div className="flex items-center gap-2">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
      <span className="text-xs text-zinc-500 flex-1 capitalize">{status ?? 'No plan'}</span>
      {!isActive ? (
        <button onClick={() => void handleSubscribe()} className="text-[10px] text-indigo-400 hover:text-indigo-300 transition-colors">Subscribe</button>
      ) : (
        <button onClick={() => void handleManage()} className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors">Manage</button>
      )}
    </div>
  );
}
