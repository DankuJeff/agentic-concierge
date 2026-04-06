import { useEffect, useRef, useState } from 'react';

const FEATURES = [
  {
    icon: (
      <svg className="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    ),
    title: 'Research & compare',
    description:
      'Give it a fuzzy request — "find me a better internet plan" — and it researches providers, compares rates, and ranks options by your criteria.',
  },
  {
    icon: (
      <svg className="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
    ),
    title: 'Draft & execute',
    description:
      "Once you pick a direction, it writes the cancellation letter, enrollment form, or negotiation script. You approve, it sends.",
  },
  {
    icon: (
      <svg className="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    title: 'Track & follow up',
    description:
      "Tasks that span days or weeks stay alive. Contract renewals, bill disputes, subscription audits — it remembers so you don't have to.",
  },
];

const USE_CASES = [
  'Compare internet providers and draft the switch letter',
  'Audit subscriptions and cancel what you don\'t use',
  'Review a contract and flag the risky clauses',
  'Dispute a bill and write the complaint letter',
  'Find a better insurance rate and handle the paperwork',
];

const AGENTS = [
  { label: 'Research', color: 'bg-blue-500/10 border-blue-500/30 text-blue-400' },
  { label: 'Document', color: 'bg-purple-500/10 border-purple-500/30 text-purple-400' },
  { label: 'Comms', color: 'bg-pink-500/10 border-pink-500/30 text-pink-400' },
  { label: 'Decision', color: 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400' },
  { label: 'Finance', color: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' },
];

type FormState = 'idle' | 'loading' | 'success' | 'already_registered' | 'error';

export default function LandingPage({ error }: { error?: string | null }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [formState, setFormState] = useState<FormState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [signupCount, setSignupCount] = useState<number | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/waitlist/count')
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { ok: boolean; data: { count: number } } | null) => {
        if (json?.ok && json.data.count > 0) setSignupCount(json.data.count);
      })
      .catch(() => null);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setFormState('loading');
    setErrorMsg('');
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), name: name.trim() || undefined }),
      });
      const json = (await res.json()) as
        | { ok: true; data: { alreadyRegistered: boolean } }
        | { ok: false; error: { message: string } };
      if (!json.ok) { setErrorMsg(json.error.message); setFormState('error'); return; }
      setFormState(json.data.alreadyRegistered ? 'already_registered' : 'success');
    } catch {
      setErrorMsg('Network error — please try again.');
      setFormState('error');
    }
  }

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col">

      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 border-b border-zinc-800/60 bg-[#09090b]/80 backdrop-blur-sm">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center">
            <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <span className="text-sm font-semibold text-zinc-100 tracking-tight">Concierge</span>
        </div>
        <a
          href="/api/auth/google"
          className="text-sm text-zinc-400 hover:text-zinc-100 transition-colors duration-150 flex items-center gap-1.5"
        >
          Sign in
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </a>
      </nav>

      {/* Auth error */}
      {error && (
        <div className="mt-16 mx-auto w-full max-w-lg px-6">
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2.5 text-sm text-red-400">
            Sign-in failed: {error}. Please try again.
          </div>
        </div>
      )}

      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center px-6 pt-32 pb-20 text-center relative overflow-hidden">
        {/* Dot grid background */}
        <div className="absolute inset-0 dot-grid opacity-60 pointer-events-none" />
        {/* Radial fade over grid */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(99,102,241,0.15),transparent)] pointer-events-none" />

        <div className="relative z-10 max-w-2xl mx-auto w-full flex flex-col items-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/25 rounded-full px-3.5 py-1 mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
            <span className="text-xs font-medium text-indigo-300 tracking-wide">Private Alpha</span>
          </div>

          {/* Headline */}
          <h1 className="text-5xl sm:text-6xl font-bold tracking-tight leading-tight mb-5">
            Stop managing<br />
            <span className="gradient-text">your own life admin.</span>
          </h1>

          <p className="text-lg text-zinc-400 mb-4 max-w-lg leading-relaxed">
            Concierge is an AI agent that handles multi-step tasks end-to-end —
            research, compare, draft, schedule, follow up — so you don't have to.
          </p>

          {/* Agent pills */}
          <div className="flex flex-wrap justify-center gap-2 mb-10">
            {AGENTS.map((a) => (
              <span key={a.label} className={`text-xs font-medium px-2.5 py-1 rounded-full border ${a.color}`}>
                {a.label} Agent
              </span>
            ))}
          </div>

          {/* Form */}
          {formState === 'success' ? (
            <div className="w-full max-w-md bg-emerald-500/10 border border-emerald-500/25 rounded-xl p-6 text-center">
              <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-3">
                <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-emerald-300 font-semibold mb-1">You're on the list.</p>
              <p className="text-emerald-500 text-sm">We'll reach out when your spot is ready.</p>
            </div>
          ) : formState === 'already_registered' ? (
            <div className="w-full max-w-md bg-indigo-500/10 border border-indigo-500/25 rounded-xl p-6 text-center">
              <p className="text-indigo-300 font-semibold mb-1">Already registered.</p>
              <p className="text-indigo-500 text-sm">You're on the waitlist. We'll be in touch soon.</p>
            </div>
          ) : (
            <form onSubmit={(e) => void handleSubmit(e)} className="w-full max-w-md space-y-3">
              <input
                ref={emailRef}
                type="text"
                placeholder="Your name (optional)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input-dark w-full px-4 py-3 rounded-xl text-sm"
              />
              <div className="flex gap-2">
                <input
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="input-dark flex-1 px-4 py-3 rounded-xl text-sm"
                />
                <button
                  type="submit"
                  disabled={formState === 'loading'}
                  className="btn-glow px-5 py-3 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-xl disabled:opacity-50 shrink-0 transition-colors duration-150"
                >
                  {formState === 'loading' ? 'Joining…' : 'Join waitlist'}
                </button>
              </div>
              {formState === 'error' && errorMsg && (
                <p className="text-sm text-red-400 text-left">{errorMsg}</p>
              )}
              {signupCount !== null && (
                <p className="text-xs text-zinc-600 text-center">
                  {signupCount.toLocaleString()} {signupCount === 1 ? 'person' : 'people'} already on the list
                </p>
              )}
            </form>
          )}

          <p className="mt-5 text-xs text-zinc-600">
            Already have access?{' '}
            <a href="/api/auth/google" className="text-indigo-400 hover:text-indigo-300 transition-colors">
              Sign in with Google →
            </a>
          </p>
        </div>
      </section>

      {/* How it works */}
      <section className="px-6 py-20 border-t border-zinc-800">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-xs font-semibold text-indigo-400 uppercase tracking-widest mb-3">How it works</p>
            <h2 className="text-3xl font-bold text-zinc-100">One request. Full execution.</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {FEATURES.map((f, i) => (
              <div key={f.title} className="card-hover bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                <div className="w-10 h-10 bg-indigo-500/10 border border-indigo-500/20 rounded-xl flex items-center justify-center mb-4">
                  {f.icon}
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-bold text-zinc-600">{String(i + 1).padStart(2, '0')}</span>
                  <p className="text-sm font-semibold text-zinc-100">{f.title}</p>
                </div>
                <p className="text-sm text-zinc-500 leading-relaxed">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Use cases */}
      <section className="px-6 py-20 border-t border-zinc-800 bg-zinc-900/30">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-xs font-semibold text-indigo-400 uppercase tracking-widest mb-3">Use cases</p>
            <h2 className="text-3xl font-bold text-zinc-100">Things it handles today</h2>
          </div>
          <ul className="space-y-3">
            {USE_CASES.map((uc, i) => (
              <li key={uc} className="flex items-center gap-4 bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-4 card-hover">
                <span className="text-xs font-bold text-zinc-700 w-5 shrink-0">{String(i + 1).padStart(2, '0')}</span>
                <span className="text-sm text-zinc-300">{uc}</span>
                <svg className="w-4 h-4 text-zinc-700 ml-auto shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-800 px-6 py-8">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 bg-indigo-600 rounded-md flex items-center justify-center">
              <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <span className="text-xs text-zinc-600">Concierge — private alpha</span>
          </div>
          <p className="text-xs text-zinc-700">Built with Claude Opus 4.6</p>
        </div>
      </footer>
    </div>
  );
}
