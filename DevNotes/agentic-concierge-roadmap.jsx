import { useState } from "react";

const phases = [
  {
    id: 0,
    phase: "Phase 0",
    title: "Prototype Foundation",
    duration: "Weeks 1–3",
    color: "#F59E0B",
    tag: "Single-Player",
    summary:
      "Stand up the core infrastructure for a single-user localhost build. No auth, no payments, no external OAuth. Just the Conductor, the DAG executor, and your personal profile seeded in the DB. Everything else builds on what gets proven here.",
    steps: [
      {
        name: "Initialize the Project",
        details: `**Stack:**
• Node.js 20+, TypeScript (strict mode), ESM modules
• Fastify — HTTP server + Server-Sent Events
• BullMQ + Redis 7 — async task queue
• Drizzle ORM + PostgreSQL 16 + pgvector

**Docker Compose (local infra only):**
\`\`\`yaml
services:
  postgres: pgvector/pgvector:pg16
  redis: redis:7-alpine
\`\`\`

**Action Items:**
• Initialize repo, tsconfig, eslint, vitest
• Configure .env (Anthropic API key is the only external credential needed)
• Bring up Docker Compose — Postgres + Redis running locally
• Verify connection from Node before writing any business logic`,
      },
      {
        name: "Conductor System Prompt v1",
        details: `The Conductor is the brain. Getting this prompt right is the most important thing in Phase 0.

**The Conductor must:**
• Receive a natural language request from the user
• Decompose it into an ordered, dependency-aware task graph (DAG)
• Assign each step to the correct specialist agent
• Assign an autonomy level to every step (1 = auto, 2 = approve, 3 = confirm)
• Assemble specialist results into a coherent response

**Prompt structure:**
1. Role definition — who the Conductor is and is not
2. Available specialist agents + what each one does
3. Output format — strict JSON task graph schema
4. Autonomy level rules — hard constraints, not suggestions
5. Escalation rules — what to do when a specialist returns needs_input

**Action Items:**
• Write Conductor system prompt as a TypeScript template function in src/conductor/prompts/conductor-system.ts
• Add PROMPT_VERSION = '1.0.0' constant
• Test with 3 sample requests: a research task, a document task, a decision task
• Verify the output is a valid task graph before touching the executor`,
      },
      {
        name: "Task Graph Decomposer + DAG Executor",
        details: `**The decomposer** takes user input → calls Conductor → parses the JSON task graph → validates it with Zod → returns a typed WorkflowPlan.

**The DAG executor** takes a WorkflowPlan → runs steps in dependency order → passes results between steps → tracks status.

**Execution model:**
\`\`\`
Steps with no dependencies → run immediately (parallel via BullMQ)
Steps with satisfied dependencies → enqueue when deps complete
Steps with pending dependencies → wait
\`\`\`

**Status state machine per step:**
pending → running → completed
pending → running → awaiting_user (Level 2/3 action hit)
pending → running → awaiting_recovery (specialist needs_input)
pending → running → failed

**Inter-step data passing:**
\`\`\`json
{ "inputs": { "providers": "$step_1.result.providers" } }
\`\`\`
The executor resolves these references before passing inputs to the next specialist.

**Action Items:**
• Implement decomposer (Conductor call → Zod parse → typed plan)
• Implement DAG executor with BullMQ job workers
• Implement $step_id.result reference resolver
• Unit test: 3-step graph with one dependency, assert correct execution order`,
      },
      {
        name: "Single-User Profile + Context System",
        details: `In the prototype, there is one user: you. No auth, no sessions, no onboarding conversation. Your profile lives in the DB, seeded once.

**Profile schema fields:**
• name, location (city, state, zip)
• household info (size, dependents)
• service accounts (current ISP, insurance provider, utilities)
• communication preferences (direct, formal, preferred channels)
• financial context (budget ranges — rough, not sensitive credentials)

**db/seed.ts:**
A one-time seed script that inserts your profile. Re-run it if you update your info.
\`\`\`
npm run db:seed
\`\`\`

**Context assembler:**
Before each specialist call, the assembler selects only the context fields relevant to that task. Keeps specialist context windows lean — don't dump everything into every prompt.

**Action Items:**
• Define user profile schema in Drizzle (src/db/schema.ts)
• Write src/db/seed.ts with your personal profile data
• Build the context assembler function (profile → per-agent context payload)
• Verify: a test Conductor call includes the right context fields for a research task

**Phase 0 Gate:**
Type a request. Conductor decomposes it into a task graph. The right specialist gets called with the right context. Result comes back structured. Yes or No — that's the only question.`,
      },
    ],
  },
  {
    id: 1,
    phase: "Phase 1",
    title: "Core Agent Capabilities",
    duration: "Weeks 4–8",
    color: "#3B82F6",
    tag: "Single-Player",
    summary:
      "Build all five specialist agents. No MCP, no OAuth — use only tools that work without external account connections. Each agent is independently testable. End goal: three complete workflows running in the browser.",
    steps: [
      {
        name: "Research Agent",
        details: `**Purpose:** Gather, compare, and synthesize information from the web and user documents.

**Tools (no OAuth required):**
• Web search — Anthropic's built-in web search tool or Serper/SerpAPI with a simple API key
• Web fetch — Firecrawl or Playwright for full page reads
• Document reader — query the user's document vault via pgvector
• Structured data extraction — parse pricing tables, feature lists, comparison data

**First workflow target: "Compare internet providers in my area"**
1. Research Agent searches for providers in the user's zip code
2. Fetches pricing pages
3. Extracts plan data into a structured comparison matrix
4. Returns: providers, plans, prices, contract terms, availability

**System prompt guidance:**
• Always cite sources with URLs and retrieval dates
• Present comparison data in structured formats (tables, ranked lists)
• Flag when data might be outdated or location-dependent
• Never fabricate pricing — if a page can't be read, say so explicitly

**Action Items:**
• Write Research Agent system prompt (src/agents/research/prompts/system.ts)
• Implement web search → fetch → extract → structure pipeline
• Build comparison matrix output format
• Integration test: "compare internet providers in [zip]" returns a structured comparison`,
      },
      {
        name: "Document Intelligence Agent",
        details: `**Purpose:** Parse, understand, and extract actionable information from complex documents.

**Tools:**
• PDF parsing — pdf-parse (text-based PDFs) + Tesseract OCR (scanned docs)
• DOCX parsing — mammoth
• Vector search — pgvector semantic search over the user's document vault

**Document ingestion pipeline:**
Upload → parse text → chunk into segments → embed via Anthropic → store in pgvector → queryable

**Key workflows:**
1. **Contract Review** — Upload a lease or service agreement → highlights key terms, renewal dates, penalties, negotiation points
2. **Policy Comparison** — Upload two insurance plans → side-by-side comparison weighted by usage patterns
3. **Bill Audit** — Upload a bill → cross-reference against contract terms, flag overcharges
4. **Document Q&A** — "What's my deductible for specialist visits?" → searches vault, answers with source reference

**Action Items:**
• Build document upload + parse + embed + store pipeline (src/context/document-vault.ts)
• Implement "important terms extraction" prompt chain for contracts
• Build side-by-side comparison output format
• Build bill audit workflow with contract cross-referencing
• Integration test: upload a sample PDF, run a Q&A query, verify correct chunk is retrieved`,
      },
      {
        name: "Communications Agent",
        details: `**Purpose:** Draft professional emails, letters, and scripts on behalf of the user.

In the prototype, this agent generates drafts only. It does not send anything. You review and send manually. Actual sending (via Gmail MCP) comes in Phase 4.

**Key workflows:**
1. **Cancellation Letters** — Properly formatted, cites contract terms, requests written confirmation
2. **Dispute / Negotiation Emails** — Right tone and legal framing for disputing charges or negotiating rates
3. **Phone Scripts** — Step-by-step scripts for retention department calls, bill disputes, accommodation requests
4. **Follow-up Templates** — Drafts for follow-up if no response after N days

**Tone calibration:**
The agent must adapt tone based on context. A Comcast cancellation letter is different from a landlord negotiation. User communication preferences (direct vs. diplomatic, formal vs. casual) are read from the user profile.

**Output format:**
Always return the draft in a clearly labeled block. Include: subject line (if email), body, suggested send timing, and a note on what to expect in response.

**Action Items:**
• Write Communications Agent system prompt with tone calibration examples
• Build template library: cancellation, dispute, negotiation, inquiry, complaint
• Implement follow-up draft generator
• Integration test: "draft a cancellation letter to Comcast" → verify letter cites account details and requests confirmation`,
      },
      {
        name: "Decision Framework Agent",
        details: `**Purpose:** Help make high-stakes decisions using personalized analysis frameworks — not generic pros/cons lists.

**What makes this different:**
Most AI tools present balanced information and leave the decision to you. This agent structures the decision around your stated priorities, weights the factors, and makes a recommendation with explicit reasoning.

**Key workflows:**
1. **Weighted Decision Matrix** — "I'm deciding between three apartments." Agent asks about priorities (commute, cost, space, safety), assigns weights, scores each option, produces a ranked recommendation.
2. **Scenario Modeling** — "Should I switch to a high-deductible health plan?" Models expected costs under multiple scenarios (healthy year, one ER visit, surgery) against your actual usage patterns.
3. **Trade-off Summary** — For any multi-factor decision, clearly states what you gain and lose with each option.

**Action Items:**
• Design priority elicitation conversation flow (Conductor asks 3–5 clarifying questions before routing to this agent)
• Build weighted scoring engine
• Implement financial scenario modeling (health plans, refinancing, lease vs. buy)
• Integration test: "compare apartment A vs B vs C" with stated priorities → ranked recommendation with reasoning`,
      },
      {
        name: "Finance Agent",
        details: `**Purpose:** Budget analysis, cost calculations, and financial modeling from manually provided data.

In the prototype, there is no Plaid integration — no OAuth to external bank accounts. The Finance Agent works with data you provide directly: uploaded bank statements, manually entered figures, or data extracted by the Document Agent from uploaded bills.

**Key workflows:**
1. **Subscription Audit** — Given a list of transactions (uploaded CSV or manually entered), identify recurring charges, flag unused or overpriced subscriptions, estimate monthly spend
2. **Switching Cost Calculator** — "What does it actually cost to switch internet providers?" — calculates early termination fees, equipment costs, installation fees vs. savings over 12 months
3. **Budget Impact Modeling** — "If I take this apartment, what's left for everything else?" — given income and expenses, models impact of a new recurring cost

**Output format:**
Always include: current state, proposed change, net impact (monthly and annually), and a clear recommendation.

**Phase 1 Gate:**
3 complete end-to-end workflows running in the browser, including at least one step that hits the approval queue. The user can see the task graph progress in the UI, approve a pending action, and see the workflow complete.`,
      },
    ],
  },
  {
    id: 2,
    phase: "Phase 2",
    title: "Workflow Persistence & UI",
    duration: "Weeks 9–12",
    color: "#8B5CF6",
    tag: "Single-Player",
    summary:
      "Make the system work across days, not just single sessions. This is where it stops being a demo and starts being an actual tool. Multi-day task persistence, a usable React interface, and recurring operations that run while you're not watching.",
    steps: [
      {
        name: "Persistent Workflow State Machine",
        details: `**The core insight:** Real tasks span days. "Switch internet providers" is: research (day 1), decide (day 3), schedule install (day 5), cancel old (day 8), verify (day 14). The system must hold state across all of that.

**State machine per workflow step:**
\`\`\`
pending → running → completed
         running → awaiting_user   (Level 2/3 action, waiting on you)
         running → awaiting_recovery (specialist hit needs_input, Conductor resolving)
         running → failed          (unrecoverable, Conductor notified)
\`\`\`

**What gets persisted:**
• Workflow record: goal, overall status, created_at, completed_at
• Task records: each step in the DAG — status, inputs, outputs, dependencies, autonomy level
• Intermediate results: $step_id.result values, available for reference by later steps

**Resumability:**
When the server restarts (or you come back tomorrow), BullMQ re-queues incomplete jobs from the DB. The executor picks them up exactly where they left off — no lost state.

**Action Items:**
• Design and migrate workflow + task DB schema (src/db/schema.ts)
• Implement workflow state machine with valid transition rules
• Wire BullMQ job persistence to DB state (on job start → update DB, on complete → update DB)
• Test: kill the server mid-workflow, restart, verify the job re-queues and completes`,
      },
      {
        name: "React Frontend — Chat + Dashboard",
        details: `**The interface should feel like texting a personal assistant, not using a dashboard.**

**Core layout:**
• Left sidebar — active workflows (list with status indicators)
• Center — chat thread with the Conductor
• Right panel — current workflow detail (task graph, step statuses, results)

**UX principles:**
• Progressive disclosure — don't show the raw task graph. Show simple status cards: "Researching providers..." → "Found 4 options. Here's the comparison." → "Ready to draft your cancellation letter?"
• Minimal input — never a form. The Conductor asks questions conversationally.
• Transparency on demand — user can expand any card to see full reasoning and sources

**Real-time updates via SSE:**
The Fastify server streams task progress events to the frontend. Each status change (step starts, step completes, approval needed) pushes an event. No polling.

**Action Items:**
• Build chat thread component (src/frontend/components/Chat/)
• Build workflow sidebar with status cards (src/frontend/components/WorkflowDashboard/)
• Implement SSE event stream connection in React
• Connect SSE events to UI state updates (workflow card updates in real-time as tasks run)`,
      },
      {
        name: "Approval Queue UI",
        details: `**The approval queue is how the autonomy level system surfaces to you.**

Every Level 2 (approve) and Level 3 (confirm) action pauses its workflow and adds an item to the approval queue. You see exactly what the agent wants to do, review it, and decide.

**Queue item display:**
• What agent is making the request
• What it wants to do (exact action, in plain English)
• The full draft/payload it will send (editable before approval)
• Why it needs approval (the autonomy level reasoning)
• One-click: Approve / Edit + Approve / Reject

**Level 3 (Confirm) items:**
Extra confirmation step. Show a summary of consequences ("This will cancel your Comcast service and initiate a $150 ETF"). User must confirm they've read it before approval.

**After approval:**
Workflow resumes automatically. SSE update pushes the "approved" event, the queued job re-enqueues, execution continues.

**After rejection:**
Conductor is notified. It can either ask the user what to do instead or mark the workflow as abandoned.

**Action Items:**
• Build approval queue component (src/frontend/components/ApprovalQueue/)
• Wire approval/rejection actions to Fastify PATCH endpoint
• Implement Level 3 confirmation step
• Test: run a workflow with a Level 2 step, verify it pauses, approve it, verify it continues`,
      },
      {
        name: "Recurring Operations Scheduler",
        details: `**This is what turns a one-shot tool into an ongoing personal ops system.**

Set-it-and-forget-it operations that run on schedules without you initiating them.

**Start with these two (highest value):**

1. **Subscription Audit** — Monthly: scan uploaded bank statements or transaction exports, flag recurring charges, identify price increases vs. last month, surface unused subscriptions. Delivers a monthly summary to your chat.

2. **Contract Renewal Watchdog** — Ongoing: tracks contract end dates from your document vault, begins research on alternatives 30–60 days before expiration, drafts a negotiation email at the 14-day mark.

**Implementation:**
• Each recurring operation is a workflow template with a cron schedule
• BullMQ's repeatable jobs handle the scheduling (persisted, survives restarts)
• Results append to a "Weekly Ops Summary" surfaced in the chat

**Phase 2 Gate:**
Kill the server. Come back the next day. Navigate to `localhost:5173`. An in-progress workflow from yesterday is visible in the sidebar, still in the correct state. Click resume — it continues. That's the gate.`,
      },
    ],
  },
  {
    id: 3,
    phase: "Phase 3",
    title: "Iteration Gate",
    duration: "Weeks 13–16",
    color: "#EF4444",
    tag: "Single-Player",
    summary:
      "This is not a build phase. This is the gate. The only question: is the single-player experience good enough to earn multiplayer? Run real tasks. Find the failure modes. Fix them. Repeat until you'd pay for this tool yourself.",
    steps: [
      {
        name: "Run 5 Real Personal Tasks",
        details: `Pick 5 things you actually need done. Not demo tasks — real ones.

**Good candidates:**
• "Compare internet providers in my area and draft a cancellation letter for my current one"
• "Review this insurance renewal document and tell me if the rate increase is justified"
• "Audit my last 3 months of bank statements for subscriptions I'm not using"
• "I'm deciding between two apartments — help me think through it"
• "Draft an email disputing this charge on my Comcast bill"

**Run each one through the Concierge. Document:**
• Did it complete without your help?
• Where did it stall or require intervention?
• Was the output actually useful or just plausible-sounding?
• Did you trust it enough to act on the result?`,
      },
      {
        name: "Identify Failure Modes",
        details: `Every system has predictable failure patterns. Find yours before anyone else does.

**Common failure modes to look for:**
• **Conductor decomposition errors** — task graph doesn't match the actual request, wrong specialist assigned, steps in wrong order
• **Specialist output quality** — research is shallow, documents aren't fully parsed, drafts don't match the tone you'd use
• **Approval queue friction** — too many approvals required for low-stakes actions, or the opposite: autonomy level is too high for something irreversible
• **Context gaps** — specialists don't have what they need, ask for things already in the profile, produce generic output instead of personalized output
• **Recovery failures** — specialist hits needs_input, Conductor can't resolve it, workflow stalls permanently
• **UI clarity** — status cards don't communicate what's actually happening, you don't know where to look`,
      },
      {
        name: "Fix. Tune. Repeat.",
        details: `Fixing failure modes is not always more code. Often it's:

**Prompt tuning:**
• Conductor prompt: tighten decomposition logic, add negative examples for misclassification patterns you saw
• Specialist prompts: add more output format constraints, improve context usage, add examples of good vs. bad output

**Workflow template refinement:**
• Add steps that were missing
• Remove steps that turned out to be unnecessary overhead
• Adjust autonomy levels based on what actually matters to you

**UI friction:**
• Reduce clicks to approve common actions
• Improve status card clarity
• Surface the right information at the right time

**Repeat this cycle until:**
The Concierge completes a full task with zero intervention from you, produces output you'd actually act on, and does it faster than you could do it yourself.

**The Gate:**
You complete 5 real tasks. You save real time. The tool works well enough that you'd miss it if it was gone. That's when it's ready for Phase 4. Not before.`,
      },
    ],
  },
  {
    id: 4,
    phase: "Phase 4",
    title: "Multiplayer Hardening",
    duration: "Weeks 17–22",
    color: "#10B981",
    tag: "Multiplayer",
    summary:
      "Everything that makes this shippable to other people. Auth, payments, OAuth integrations, encryption, multi-tenant isolation, and production infrastructure. None of this gets touched until the Phase 3 gate is passed.",
    steps: [
      {
        name: "Auth + Multi-Tenant Data Layer",
        details: `**Now that it's not just you, every user needs their own isolated space.**

**Auth system:**
• Lucia Auth + OAuth2 — users sign up, sessions managed via JWT
• No passwords stored — OAuth2 social login (Google at minimum)
• MFA support from day one

**Multi-tenant isolation:**
• Every DB table gets a user_id foreign key (if it doesn't already)
• Every query scoped: WHERE user_id = $currentUserId
• No cross-user data leakage — this is audited, not assumed

**Session management:**
• Replace the hardcoded single-user profile with session-based user lookup
• Seeded profile becomes the onboarding conversation (Conductor gathers info naturally)

**Action Items:**
• Add Lucia Auth to the stack
• Add user_id to all tables, audit every Drizzle query
• Build login / OAuth2 callback routes
• Replace seed.ts flow with real onboarding`,
      },
      {
        name: "External OAuth Integrations (MCP + Plaid)",
        details: `**These require OAuth2 because you're accessing other people's accounts — not just yours.**

**MCP Gmail integration:**
• Users connect their Gmail via Google OAuth2
• Gmail MCP server handles read/send scopes
• Communications Agent can now actually send approved emails, not just draft them
• Follow-up tracking becomes real (check for replies, trigger follow-ups)

**MCP Google Calendar:**
• Users connect their calendar
• Schedule appointments, set reminders, find availability slots
• Scheduling Agent can book confirmed appointments with Level 3 autonomy

**Plaid financial integration:**
• Users connect their bank accounts (read-only, via Plaid Link)
• Finance Agent and recurring Subscription Audit now work on live transaction data
• No more manual CSV uploads

**Action Items:**
• Build OAuth2 connection flow for Gmail + Calendar
• Build OAuth2 Plaid Link flow
• Update relevant agent tools to use connected accounts
• Build integration management UI (connect/disconnect services)`,
      },
      {
        name: "Security Hardening",
        details: `**You're handling other people's financial data, contracts, and emails. This isn't optional.**

**Encryption at rest:**
• pgcrypto for the document vault — user documents encrypted at the DB level
• Encryption key per user, stored separately

**Audit logging:**
• Every agent action, every API call, every data access logged with timestamp, user ID, and outcome
• Immutable — append-only audit log table

**Data isolation audit:**
• Review every DB query — any that don't scope by user_id are a bug
• Review every API endpoint — verify auth middleware runs on all protected routes

**Data deletion:**
• Users can delete all their data with one action
• Hard delete on explicit request (soft delete is default, hard delete is for account closure)

**Rate limiting:**
• Per-user rate limits on the chat endpoint and workflow creation
• Per-user Anthropic API usage tracking (important for billing)

**Action Items:**
• Implement pgcrypto document vault encryption
• Build audit log infrastructure
• Run full query audit — scope check on every table
• Build account deletion flow
• Add rate limiting middleware to Fastify`,
      },
      {
        name: "Stripe Billing + Production Infrastructure",
        details: `**Monetization and deployment. Last things added — first things people ask about.**

**Stripe billing:**
• Freemium model: 3–5 tasks/month free, unlimited on paid tier
• Target price: $15–25/month (must be visibly less than the value it saves)
• Stripe webhooks → update user subscription status in DB
• Usage tracking: per-user task counts for free tier enforcement

**Production infrastructure:**
• Multi-stage Docker build (node:20-slim base, no dev dependencies in prod)
• CI/CD pipeline: type-check → lint → tests → build → deploy
• Health check endpoints
• Structured logging (JSON, goes to your log aggregator)
• HTTPS/TLS — terminate at the load balancer

**Compliance:**
• Privacy policy + Terms of Service (consult a lawyer — you're handling financial data)
• CCPA compliance (you're in California — data export and deletion rights)
• Cookie consent if you use analytics

**Action Items:**
• Add Stripe subscription management
• Set up production Docker build
• Configure CI/CD pipeline
• Write privacy policy + ToS
• Set up monitoring and alerting`,
      },
    ],
  },
  {
    id: 5,
    phase: "Phase 5",
    title: "Launch",
    duration: "Weeks 23–26",
    color: "#EC4899",
    tag: "Multiplayer",
    summary:
      "Don't try to launch everything. Launch one killer workflow and nail it. The Subscription Audit is the right first workflow — low risk, high visible ROI, natural expansion point.",
    steps: [
      {
        name: "Subscription Audit — Launch Workflow",
        details: `**The right first workflow to launch with:**

Why this one:
• Low risk — read-only financial analysis, no irreversible actions
• High immediate ROI — most people are overpaying for something
• Easy to demonstrate value ("The Concierge saved you $47/month")
• Natural trust-builder — once users trust it with subscriptions, they'll trust it with bigger tasks

**Make this one workflow exceptional:**
• Crystal-clear output format
• Specific, actionable recommendations (not "consider reviewing your subscriptions")
• One-click to draft cancellation or negotiation emails for flagged items
• Accurate savings estimate

**Action Items:**
• Polish the subscription audit workflow template end-to-end
• User test with 3–5 alpha testers, watch them run it without guidance
• Fix every point of confusion before broader launch`,
      },
      {
        name: "Private Alpha → Closed Beta → Public",
        details: `**Staged rollout. Don't skip stages.**

**Private Alpha (10–20 people):**
• Friends, family, colleagues you can reach directly
• Hands-on support — you're in the loop on every task they run
• Gather feedback aggressively: what worked, what didn't, what they actually wanted to use it for
• Measure: task completion rate, time-to-complete, did they use it more than once

**Closed Beta (100–500 people):**
• Invite list via waitlist
• Implement feedback from alpha
• Start tracking: which workflows are most requested? Where do users drop off?
• Begin thinking about which workflow to add next (based on data, not guesses)

**Public Beta:**
• Open signups
• Add the next 2–3 workflow types based on what beta users request most
• Instrument everything — you need data to know what to build next

**Action Items:**
• Build waitlist landing page
• Set up analytics (task completion rate, time saved, user satisfaction, retention)
• Recruit alpha testers
• Define success metrics for each stage before opening it`,
      },
    ],
  },
];

export default function AgenticConciergeRoadmap() {
  const [activePhase, setActivePhase] = useState(0);
  const [activeStep, setActiveStep] = useState(0);
  const phase = phases[activePhase];
  const step = phase.steps[activeStep];

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#09090B",
        color: "#E4E4E7",
        fontFamily: "'Segoe UI', 'Helvetica Neue', sans-serif",
      }}
    >
      {/* Header */}
      <div style={{ padding: "28px 36px 20px", borderBottom: "1px solid #1C1C20" }}>
        <div style={{ fontSize: 10, letterSpacing: 4, color: "#52525B", textTransform: "uppercase", marginBottom: 6 }}>
          Product Build Roadmap
        </div>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: "#FAFAFA" }}>
          Agentic Concierge
          <span style={{ color: "#10B981", marginLeft: 10, fontSize: 14, fontWeight: 500 }}>
            — Prototype-First Implementation Guide
          </span>
        </h1>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "#71717A", maxWidth: 700 }}>
          Phases 0–3: single-player localhost prototype. Phase 4–5: multiplayer production.
          If single-player isn't good enough, it's not ready for multiplayer.
        </p>
      </div>

      {/* Phase Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid #1C1C20", overflowX: "auto" }}>
        {phases.map((p, i) => (
          <button
            key={p.id}
            onClick={() => { setActivePhase(i); setActiveStep(0); }}
            style={{
              flex: 1,
              minWidth: 120,
              padding: "12px 14px",
              background: activePhase === i ? "#111113" : "transparent",
              border: "none",
              borderBottom: activePhase === i ? `2px solid ${p.color}` : "2px solid transparent",
              color: activePhase === i ? "#FAFAFA" : "#52525B",
              cursor: "pointer",
              transition: "all 0.2s",
              textAlign: "left",
            }}
          >
            <div style={{ fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color: activePhase === i ? p.color : "#3F3F46", fontWeight: 700, marginBottom: 2 }}>
              {p.phase} · {p.tag}
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.3 }}>{p.title}</div>
            <div style={{ fontSize: 10, color: "#52525B", marginTop: 2 }}>{p.duration}</div>
          </button>
        ))}
      </div>

      <div style={{ display: "flex", height: "calc(100vh - 172px)" }}>
        {/* Step Sidebar */}
        <div style={{ width: 260, borderRight: "1px solid #1C1C20", overflowY: "auto", flexShrink: 0, background: "#0C0C0E" }}>
          <div style={{ padding: "16px 16px 8px", fontSize: 11, color: "#52525B", fontWeight: 600, letterSpacing: 1.5, textTransform: "uppercase" }}>
            Steps
          </div>
          {phase.steps.map((s, i) => (
            <button
              key={i}
              onClick={() => setActiveStep(i)}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                width: "100%",
                padding: "12px 16px",
                background: activeStep === i ? "#18181B" : "transparent",
                border: "none",
                borderLeft: activeStep === i ? `3px solid ${phase.color}` : "3px solid transparent",
                color: activeStep === i ? "#FAFAFA" : "#71717A",
                cursor: "pointer",
                textAlign: "left",
                transition: "all 0.15s",
              }}
            >
              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 5,
                  background: activeStep === i ? phase.color + "22" : "#1C1C20",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontWeight: 700,
                  color: activeStep === i ? phase.color : "#52525B",
                  flexShrink: 0,
                  marginTop: 1,
                }}
              >
                {i + 1}
              </div>
              <div style={{ fontSize: 12.5, fontWeight: activeStep === i ? 600 : 400, lineHeight: 1.4 }}>
                {s.name}
              </div>
            </button>
          ))}

          {/* Phase Summary */}
          <div style={{ padding: "16px", borderTop: "1px solid #1C1C20", marginTop: 8 }}>
            <div style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: phase.color, fontWeight: 700, marginBottom: 8 }}>
              Phase Summary
            </div>
            <p style={{ fontSize: 11.5, lineHeight: 1.6, color: "#71717A", margin: 0 }}>
              {phase.summary}
            </p>
          </div>
        </div>

        {/* Main Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "28px 36px" }}>
          <div style={{ maxWidth: 780 }}>
            {/* Step Header */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: phase.color, fontWeight: 700 }}>
                  {phase.phase} · Step {activeStep + 1} of {phase.steps.length}
                </div>
                <div style={{
                  fontSize: 9,
                  letterSpacing: 2,
                  textTransform: "uppercase",
                  color: phase.tag === "Single-Player" ? "#F59E0B" : "#10B981",
                  fontWeight: 700,
                  background: phase.tag === "Single-Player" ? "#F59E0B11" : "#10B98111",
                  padding: "2px 8px",
                  borderRadius: 4,
                  border: `1px solid ${phase.tag === "Single-Player" ? "#F59E0B33" : "#10B98133"}`,
                }}>
                  {phase.tag}
                </div>
              </div>
              <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#FAFAFA" }}>
                {step.name}
              </h2>
            </div>

            {/* Step Content */}
            <div style={{ fontSize: 13.5, lineHeight: 1.8, color: "#A1A1AA" }}>
              {step.details.split("\n\n").map((block, i) => {
                if (block.startsWith("```")) {
                  const lines = block.split("\n");
                  const code = lines.slice(1, -1).join("\n");
                  return (
                    <pre
                      key={i}
                      style={{
                        background: "#111113",
                        border: "1px solid #1C1C20",
                        borderRadius: 8,
                        padding: "16px 20px",
                        fontSize: 12,
                        lineHeight: 1.6,
                        overflowX: "auto",
                        color: "#D4D4D8",
                        margin: "16px 0",
                        fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
                      }}
                    >
                      {code}
                    </pre>
                  );
                }

                if (block.startsWith("**") && block.includes(":**")) {
                  const titleEnd = block.indexOf(":**") + 3;
                  const title = block.substring(0, titleEnd).replace(/\*\*/g, "");
                  const rest = block.substring(titleEnd);
                  return (
                    <div key={i} style={{ margin: "16px 0" }}>
                      <span style={{ color: "#E4E4E7", fontWeight: 600 }}>{title}</span>
                      {rest.split("\n").map((line, j) => {
                        const trimmed = line.trim();
                        if (trimmed.startsWith("•") || trimmed.startsWith("- ")) {
                          const content = trimmed.replace(/^[•\-]\s*/, "");
                          const boldMatch = content.match(/^\*\*(.+?)\*\*(.*)$/);
                          return (
                            <div key={j} style={{ paddingLeft: 16, margin: "4px 0", display: "flex", gap: 8 }}>
                              <span style={{ color: phase.color, flexShrink: 0 }}>›</span>
                              <span>
                                {boldMatch ? (
                                  <>
                                    <span style={{ color: "#D4D4D8", fontWeight: 600 }}>{boldMatch[1]}</span>
                                    <span>{boldMatch[2]}</span>
                                  </>
                                ) : content}
                              </span>
                            </div>
                          );
                        }
                        return <span key={j}>{line}<br /></span>;
                      })}
                    </div>
                  );
                }

                if (block.includes("\n•") || block.includes("\n- ")) {
                  return (
                    <div key={i} style={{ margin: "12px 0" }}>
                      {block.split("\n").map((line, j) => {
                        const trimmed = line.trim();
                        if (trimmed.startsWith("•") || trimmed.startsWith("- ")) {
                          const content = trimmed.replace(/^[•\-]\s*/, "");
                          const boldMatch = content.match(/^\*\*(.+?)\*\*\s*[—–-]\s*(.*)$/);
                          return (
                            <div key={j} style={{ paddingLeft: 16, margin: "6px 0", display: "flex", gap: 8 }}>
                              <span style={{ color: phase.color, flexShrink: 0 }}>›</span>
                              <span>
                                {boldMatch ? (
                                  <>
                                    <span style={{ color: "#D4D4D8", fontWeight: 600 }}>{boldMatch[1]}</span>
                                    <span style={{ color: "#71717A" }}> — </span>
                                    <span>{boldMatch[2]}</span>
                                  </>
                                ) : content}
                              </span>
                            </div>
                          );
                        }
                        if (trimmed.match(/^\d+\./)) {
                          const content = trimmed.replace(/^\d+\.\s*/, "");
                          const num = trimmed.match(/^(\d+)\./)?.[1];
                          return (
                            <div key={j} style={{ paddingLeft: 16, margin: "6px 0", display: "flex", gap: 8 }}>
                              <span style={{ color: phase.color, fontWeight: 700, flexShrink: 0, fontSize: 12 }}>{num}.</span>
                              <span>{content.replace(/\*\*(.+?)\*\*/g, (_, t) => t)}</span>
                            </div>
                          );
                        }
                        if (trimmed) {
                          return <p key={j} style={{ margin: "8px 0" }}>{trimmed.replace(/\*\*(.+?)\*\*/g, (_, t) => t)}</p>;
                        }
                        return null;
                      })}
                    </div>
                  );
                }

                return (
                  <p key={i} style={{ margin: "12px 0" }}>
                    {block.split(/(\*\*.*?\*\*)/).map((seg, j) => {
                      if (seg.startsWith("**") && seg.endsWith("**")) {
                        return <span key={j} style={{ color: "#D4D4D8", fontWeight: 600 }}>{seg.slice(2, -2)}</span>;
                      }
                      return <span key={j}>{seg}</span>;
                    })}
                  </p>
                );
              })}
            </div>

            {/* Navigation */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: 32,
                paddingTop: 20,
                borderTop: "1px solid #1C1C20",
              }}
            >
              <button
                onClick={() => {
                  if (activeStep > 0) setActiveStep(activeStep - 1);
                  else if (activePhase > 0) {
                    setActivePhase(activePhase - 1);
                    setActiveStep(phases[activePhase - 1].steps.length - 1);
                  }
                }}
                disabled={activePhase === 0 && activeStep === 0}
                style={{
                  padding: "10px 20px",
                  background: "#18181B",
                  border: "1px solid #27272A",
                  borderRadius: 6,
                  color: activePhase === 0 && activeStep === 0 ? "#3F3F46" : "#A1A1AA",
                  cursor: activePhase === 0 && activeStep === 0 ? "default" : "pointer",
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                ← Previous
              </button>
              <div style={{ fontSize: 11, color: "#52525B", alignSelf: "center" }}>
                Step {phases.slice(0, activePhase).reduce((a, p) => a + p.steps.length, 0) + activeStep + 1} of{" "}
                {phases.reduce((a, p) => a + p.steps.length, 0)}
              </div>
              <button
                onClick={() => {
                  if (activeStep < phase.steps.length - 1) setActiveStep(activeStep + 1);
                  else if (activePhase < phases.length - 1) {
                    setActivePhase(activePhase + 1);
                    setActiveStep(0);
                  }
                }}
                disabled={activePhase === phases.length - 1 && activeStep === phase.steps.length - 1}
                style={{
                  padding: "10px 20px",
                  background: phase.color + "22",
                  border: `1px solid ${phase.color}44`,
                  borderRadius: 6,
                  color: activePhase === phases.length - 1 && activeStep === phase.steps.length - 1 ? "#3F3F46" : phase.color,
                  cursor: activePhase === phases.length - 1 && activeStep === phase.steps.length - 1 ? "default" : "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                Next →
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
