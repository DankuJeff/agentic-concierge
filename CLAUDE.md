# Agentic Concierge — CLAUDE.md

> **Single source of truth for all Claude Code agents working on this project.**
> Every agent (builder, researcher, reviewer, deployer) MUST read this file before doing any work.

---

## Project Overview

**Agentic Concierge** is an AI-powered personal operations agent that executes multi-step life administration tasks end-to-end. Unlike chatbots that answer questions and leave execution to the user, the Concierge decomposes fuzzy requests into executable task graphs, delegates to specialist AI agents, maintains state across days/weeks, and handles the full lifecycle — research, comparison, drafting, scheduling, and follow-up.

**Core Philosophy:** "I don't want to talk to my computer. I want it to do the work."

---

## Architecture

### System Pattern: Orchestrator + Specialist Agents

```
User Request
    │
    ▼
┌─────────────┐
│  Conductor   │  ← Decomposes requests into task graphs
│  (Opus 4.6)  │  ← Routes subtasks to specialists
└──────┬──────┘
       │
  ┌────┼────┬────────┬──────────┐
  ▼    ▼    ▼        ▼          ▼
┌────┐┌────┐┌────┐┌──────┐┌─────────┐
│Res.││Doc.││Comm││Decide││Finance  │
│Agt ││Agt ││Agt ││Agt   ││Agt      │
└────┘└────┘└────┘└──────┘└─────────┘
  │    │    │        │          │
  └────┴────┴────────┴──────────┘
       │
       ▼
  Task Results → Conductor → User
```

**Conductor Agent** — claude-opus-4-6
- Receives user requests, generates task graphs (DAG)
- Routes subtasks to specialist agents
- Assembles final results, manages human-in-the-loop checkpoints
- Only agent that communicates directly with the user

**Specialist Agents** — claude-sonnet-4-6
- Each has a focused system prompt, limited tool access, and clean context
- Receive structured task inputs, return structured results
- Never communicate directly with the user

### Inter-Agent Communication Schema

```json
{
  "task_id": "uuid",
  "workflow_id": "uuid",
  "agent": "research | document | comms | decision | finance",
  "action": "string",
  "inputs": {},
  "depends_on": ["task_id"],
  "recovery_for": "task_id | null",
  "recovery_attempts": 0,
  "status": "pending | running | awaiting_user | awaiting_recovery | completed | failed | skipped",
  "result": {},
  "needs_input_reason": "string | null",
  "suggested_resolution": "string | null",
  "error": null,
  "created_at": "ISO8601",
  "completed_at": "ISO8601"
}
```

---

## Build Strategy: Prototype-First

The project follows a prototype-first approach. Phases 0–3 build a localhost-only single-user product. Phases 4–5 add everything required to ship it to other people.

**The rule:** If single-player isn't good enough to use yourself, it's not ready for multiplayer.

### Prototype Constraints (Phases 0–3)
These are intentionally deferred until Phase 4. Do not add them during the prototype:

| Feature | Why Deferred |
|---------|-------------|
| Lucia Auth + OAuth2 | No other users — no sessions needed |
| Stripe billing | No paying customers yet |
| MCP Gmail/Calendar | Requires OAuth2 flows (multi-user concern) |
| Plaid integration | OAuth2 again |
| pgcrypto encryption at rest | It's your machine — unnecessary overhead |
| Rate limiting middleware | No public API surface |
| Multi-tenant data isolation | Single user |
| HTTPS/TLS | localhost HTTP is fine |
| CI/CD, production Docker | Not deploying anywhere yet |
| GDPR/CCPA, ToS, privacy policy | No users |

**What the prototype has instead:**
- A single `.env` with your Anthropic API key — the only credential needed
- Your profile seeded once via `src/db/seed.ts` — no login, no onboarding
- Open to `localhost:5173`, start working

---

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Runtime | Node.js 20+ (TypeScript) | Strict mode, ESM modules |
| AI | Anthropic Claude API | Opus for Conductor, Sonnet for specialists |
| Framework | Fastify | HTTP server + WebSocket support |
| Task Queue | BullMQ + Redis | Async workflow execution |
| Database | PostgreSQL 16 | Structured data + user profiles |
| Vector Store | pgvector extension | Document semantic search |
| Cache | Redis 7+ | Session state, task status |
| Frontend | React 18 + Tailwind CSS | Conversation UI + workflow dashboard |
| Real-time | Server-Sent Events | Task progress updates to frontend |
| Web Research | Firecrawl or Playwright | Page fetching and extraction |
| Doc Parsing | pdf-parse, mammoth, Tesseract | PDF, DOCX, OCR |
| Auth | Lucia Auth + OAuth2 | **Phase 4+ only** |
| Payments | Stripe | **Phase 4+ only** |
| MCP Integrations | Gmail, Google Calendar | **Phase 4+ only** |
| Financial | Plaid | **Phase 4+ only** |

---

## Directory Structure

```
agentic-concierge/
├── .claude/
│   ├── agents/              # Agent-specific instructions
│   │   ├── builder.md       # Implementation agent
│   │   ├── reviewer.md      # Code review agent
│   │   ├── researcher.md    # Research/architecture agent
│   │   └── deployer.md      # DevOps/deployment agent
│   ├── hooks/               # Claude Code automation hooks
│   │   ├── pre-commit.py    # Lint + type-check before commit
│   │   └── post-build.py    # Run tests after builds
│   └── skills/              # Project-specific skills
│       ├── agent-prompt.md  # How to write specialist agent prompts
│       └── workflow-def.md  # How to define new workflow types
├── src/
│   ├── conductor/           # Conductor agent logic
│   │   ├── conductor.ts     # Main orchestrator
│   │   ├── decomposer.ts    # Request → task graph
│   │   ├── dag-executor.ts  # DAG execution engine
│   │   └── prompts/
│   │       └── conductor-system.ts
│   ├── agents/              # Specialist agent implementations
│   │   ├── base-agent.ts    # Abstract base class
│   │   ├── research/
│   │   │   ├── agent.ts
│   │   │   ├── tools.ts
│   │   │   └── prompts/
│   │   │       └── system.ts
│   │   ├── document/
│   │   │   ├── agent.ts
│   │   │   ├── tools.ts
│   │   │   └── prompts/
│   │   │       └── system.ts
│   │   ├── comms/
│   │   │   ├── agent.ts
│   │   │   ├── tools.ts
│   │   │   └── prompts/
│   │   │       └── system.ts
│   │   ├── decision/
│   │   │   ├── agent.ts
│   │   │   ├── tools.ts
│   │   │   └── prompts/
│   │   │       └── system.ts
│   │   └── finance/
│   │       ├── agent.ts
│   │       ├── tools.ts
│   │       └── prompts/
│   │           └── system.ts
│   ├── workflows/           # Workflow definitions
│   │   ├── engine.ts        # Workflow state machine
│   │   ├── templates/       # Predefined workflow templates
│   │   │   ├── subscription-audit.ts
│   │   │   ├── service-switch.ts
│   │   │   ├── contract-review.ts
│   │   │   └── bill-dispute.ts
│   │   └── scheduler.ts     # Recurring workflow cron
│   ├── context/             # User context management
│   │   ├── profile.ts       # User profile CRUD
│   │   ├── document-vault.ts # Encrypted doc storage + vectors
│   │   └── assembler.ts     # Per-agent context assembly
│   ├── integrations/        # External service connections
│   │   ├── mcp/
│   │   │   ├── gmail.ts
│   │   │   └── calendar.ts
│   │   ├── web/
│   │   │   ├── search.ts
│   │   │   └── fetch.ts
│   │   └── financial/
│   │       └── plaid.ts
│   ├── api/                 # HTTP + WebSocket endpoints
│   │   ├── server.ts
│   │   ├── routes/
│   │   │   ├── chat.ts      # Conversation endpoint
│   │   │   ├── workflows.ts # Workflow management
│   │   │   ├── documents.ts # Document upload/query
│   │   │   └── auth.ts      # Authentication
│   │   └── middleware/
│   │       ├── auth.ts
│   │       └── rate-limit.ts
│   ├── db/                  # Database layer
│   │   ├── schema.ts        # Drizzle ORM schema
│   │   ├── migrations/
│   │   └── seed.ts
│   └── shared/              # Shared types and utilities
│       ├── types.ts
│       ├── errors.ts
│       └── logger.ts
├── frontend/                # React frontend
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── Chat/
│   │   │   ├── WorkflowDashboard/
│   │   │   ├── ApprovalQueue/
│   │   │   └── DocumentVault/
│   │   └── hooks/
│   └── tailwind.config.js
├── tests/
│   ├── unit/
│   ├── integration/
│   └── workflows/           # End-to-end workflow tests
├── package.json
├── tsconfig.json
├── drizzle.config.ts
├── docker-compose.yml       # PostgreSQL + Redis for local dev
├── .env.example
└── CLAUDE.md                # ← You are here
```

---

## Coding Standards

### TypeScript Rules
- **Strict mode always.** No `any` types except at API boundaries with explicit validation.
- **Zod for all external data.** Every API response, user input, and inter-agent message gets Zod validation.
- **Result pattern over exceptions.** Functions that can fail return `{ ok: true, data } | { ok: false, error }` — never throw for expected failures.
- **Explicit over implicit.** No default exports except React components. Named exports everywhere.

### Agent Prompt Rules
- All system prompts live in `src/[agent]/prompts/system.ts` as template literal functions that accept context parameters.
- Prompts are versioned — include a `PROMPT_VERSION` constant. Increment when changing behavior.
- Every prompt must include: role definition, available tools, output format spec, and explicit constraints.
- Test prompts against edge cases before merging (see `.claude/skills/agent-prompt.md`).

### Database Rules
- Use Drizzle ORM — no raw SQL except in migrations.
- All user data encrypted at rest via pgcrypto.
- Every table has `created_at`, `updated_at` timestamps.
- Soft delete only — never hard delete user data without explicit user request.

### Error Handling
- External API calls: retry with exponential backoff (3 attempts, 1s/2s/4s).
- Agent failures: log full context, mark task as `failed`, notify Conductor to attempt recovery or ask user.
- Never swallow errors silently. Every catch block either handles or re-throws.

### Testing
- Unit tests for all utility functions and data transformations.
- Integration tests for each agent (mock the Claude API, test tool routing and output parsing).
- End-to-end workflow tests for the top 5 workflow templates.
- Target: 80%+ coverage on `src/conductor/` and `src/agents/`.

---

## Autonomy Levels

Every workflow step has an autonomy level. This is a HARD rule — no exceptions.

| Level | Actions | Approval |
|-------|---------|----------|
| 1 — Auto | Research, read docs, compare, draft | None needed |
| 2 — Approve | Send email, submit form, schedule | User sees action, one-click approve |
| 3 — Confirm | Financial tx, cancel service, sign up | User reviews details + explicit confirm |

The Conductor MUST assign an autonomy level to every task in the graph. Default to Level 2 if uncertain.

---

## Escalation & Recovery Protocol

When a specialist cannot complete a task, it must NOT guess or fabricate. It returns `needs_input` and the system recovers autonomously.

### The Recovery Loop

```
Specialist hits a gap
  → returns { status: 'needs_input', needsInputReason: '<specific>', suggestedResolution: '<who can answer>' }
  → Conductor classifies:
      ├─ Researchable  → spawn Research subtask with recoveryFor = blocked task ID
      │                   mark blocked task status = 'awaiting_recovery'
      ├─ User-required → pause workflow, notify user via SSE
      │                   mark blocked task status = 'awaiting_user'
      └─ Unrecoverable → mark task 'failed', attempt template fallback path or abort
  → Recovery task completes → Conductor injects result into blocked task's inputs
  → Blocked task re-queued with enriched inputs → specialist resumes
```

### Rules
- **Max 2 recovery attempts** per task (`recoveryAttempts` field). On the 3rd failure, escalate to user.
- **Recovery tasks are AUTO autonomy** — research to unblock is internal, never requires user approval.
- **`needsInputReason` must be specific**: name exactly what is missing, why it's needed, and where to get it.
- **`suggestedResolution`** guides the Conductor's routing decision. Use values like: `"research_agent"`, `"user_input"`, `"read_file:<path>"`, `"update_agent_instructions"`.

---

## Lead Agent Authority

The Lead Agent (Claude Code instance orchestrating development) has explicit authority to update any file in `.claude/agents/` and `.claude/skills/` when patterns are identified that improve team performance. This is expected behavior, not an exception.

### Triggers for Updating Agent Files
- A specialist repeatedly returns `needs_input` for the same category of missing information → update that agent's instructions to proactively gather it
- A specialist produces output requiring consistent reformatting → update its output format spec
- A new utility is added to `src/shared/` → update relevant agent files to reference it
- A workflow template fails in a predictable way → update `workflow-def.md` with the pattern and fallback

### Update Protocol
1. Edit the agent `.md` file directly
2. If changing behavior (not just adding clarity), increment `PROMPT_VERSION` in `src/agents/[name]/prompts/system.ts`
3. Add a one-line entry to the Key Decisions Log below with the date and rationale
4. The `post-build.py` hook verifies all prompt files have version constants

---

## Phase Roadmap

### Phase 0 — Prototype Foundation
*Single-user localhost. No auth, no payments, no external OAuth.*

**Gate:** Conductor receives a request, decomposes into a task graph, routes to the right specialist. Yes/No.

- [ ] Initialize TypeScript project with Fastify + Drizzle + BullMQ
- [ ] Write Conductor system prompt v1
- [ ] Implement task graph decomposer
- [ ] Implement DAG executor with dependency resolution + status tracking
- [ ] Design DB schema (single user, workflows, tasks, documents)
- [ ] Build user context assembler (reads from seeded single profile)
- [ ] Create `src/db/seed.ts` — personal profile seed (replaces onboarding for prototype)
- [ ] Set up Docker Compose for local PostgreSQL 16 + Redis 7

### Phase 1 — Core Agent Capabilities
*All 5 specialists. No MCP (no OAuth). Each independently testable.*

**Gate:** 3 complete end-to-end workflows in the browser including approval queue steps.

- [ ] Research Agent — web search + fetch → comparison output
- [ ] Document Agent — PDF/DOCX parsing + pgvector semantic search
- [ ] Communications Agent — draft emails/letters/scripts (no send yet)
- [ ] Decision Framework Agent — weighted matrices, scenario modeling
- [ ] Finance Agent — budget analysis, cost calculations (manual input, no Plaid)
- [ ] First workflow target: "Compare internet providers in my area"

### Phase 2 — Workflow Persistence & UI
*Make it usable across days, not just single sessions.*

**Gate:** Walk away mid-workflow, return next day, picks up exactly where it left off.

- [ ] Persistent workflow state machine (pending → running → awaiting_user → completed → failed)
- [ ] React UI — chat thread + workflow sidebar + status cards
- [ ] Approval queue UI (shows exact proposed action, one-click approve/edit/reject)
- [ ] Workflow resumability — load state on restart, continue from last step
- [ ] Recurring operations scheduler (subscription audit, contract renewal watchdog)
- [ ] SSE for real-time task progress

### Phase 3 — Iteration Gate
*Not a build phase. Does the product work well enough to earn multiplayer?*

**Gate:** 5 real personal tasks completed, genuine time saved, tool usable without babysitting.

- [ ] Run 5 real personal tasks through the Concierge
- [ ] Identify failure modes — bad output, stalling, excess hand-holding
- [ ] Fix: prompt tuning, workflow refinement, UI friction, edge cases
- [ ] Repeat until it earns the right to be shared

### Phase 4 — Multiplayer Hardening
*Everything that makes it shippable to other people. Only after Phase 3 gate passes.*

- [ ] Lucia Auth + OAuth2 (user accounts, sessions)
- [ ] Multi-tenant data isolation (all queries scoped to user ID)
- [ ] MCP Gmail + Calendar integrations (now needs OAuth because it's not just you)
- [ ] Plaid financial data
- [ ] pgcrypto encryption at rest for document vault
- [ ] Stripe billing + subscription management
- [ ] Rate limiting, API key management
- [ ] Audit logging + security review
- [ ] HTTPS/TLS, production Docker build, CI/CD
- [ ] Privacy policy, ToS, CCPA compliance

### Phase 5 — Launch
- [ ] Private alpha (10–20 people, hands-on support)
- [ ] Analytics — task completion rate, time saved, satisfaction
- [ ] Waitlist landing page
- [ ] Closed beta (100–500 via invite)
- [ ] Public beta

## Current Sprint

> Update this section as work progresses.

**Phase:** 5 — Private Alpha
**Focus:** Phase 5 — Launch (private alpha next)

### Phase 4 COMPLETE + Bug-Fixed (2026-04-05)
- [x] Block 1 — Auth + multi-tenant + rate limiting (2026-04-01)
- [x] Block 2 — MCP Gmail + Google Calendar (2026-04-01)
- [x] Block 3 — pgcrypto encryption at rest + audit logging (2026-04-05)
- [x] Block 4 — Stripe (test mode) + Plaid (sandbox) (2026-04-05)
- [x] Block 5 — Dockerfile + GitHub Actions CI/CD (2026-04-05)
- [x] Phase 4 code review + bug fixes (2026-04-05)

### Phase 2 Completed (2026-03-30 – 2026-03-31)
- [x] Approval queue endpoints — GET /tasks/pending-approval, POST /tasks/:id/approve, POST /tasks/:id/reject
- [x] SSE endpoint — GET /workflows/:id/events, 15s keep-alive ping, client-disconnect cleanup
- [x] In-process worker — BullMQ worker embedded in server.ts; `npm run dev` starts server + worker
- [x] Frontend — Vite 5 + React 18 + TypeScript + Tailwind CSS, port 5173
  - Chat.tsx — POST /api/chat, workflow plan display, live SSE task status, clarification state machine
  - WorkflowDashboard.tsx — workflow list sidebar, task detail panel, per-step SSE live status, auto-refresh/auto-select
  - ApprovalQueue.tsx — polls /tasks/pending-approval, approve/reject wired
- [x] Workflow resumability — resumeActiveWorkflows() at startup, BullMQ jobId dedup (enqueueTask)
- [x] App.tsx — lastWorkflowId lifted, Chat → WorkflowDashboard auto-refresh/auto-select
- [x] Conductor clarification flow — conductor-system.ts v1.1.0, Plan|Clarification discriminated union in decomposer/conductor, 3-round cap, chat route dual response shape, Chat.tsx stitching + amber UI

### Phase 1 Completed (2026-03-30)
- [x] Research Agent — DuckDuckGo + Playwright/Edge, max 12 tool calls
- [x] Finance Agent — single-turn reasoning, cost/savings calculations
- [x] Decision Agent — single-turn reasoning, weighted matrices + ranked recommendations
- [x] Comms Agent — single-turn reasoning, drafts cancellation/enrollment/phone scripts
- [x] Document Agent — tool-use loop, listDocuments/searchDocuments/readDocument, ingest PDF/DOCX

### Phase 0 Completed (2026-03-29)
- [x] All 18 Phase 0 implementation files written
- [x] Gate test passed

### Known Open Issues
- Recovery loop not implemented: awaiting_recovery tasks stay stuck — no re-enqueue after recovery research completes
- SSE events missed if client connects after fast tasks complete — Phase 4: add last-N events replay
- Task IDs contain colons — must be URL-encoded (%3A) in route paths (e.g. /tasks/wf-id%3Astep_1/approve)

---

## Key Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-06 | TypeScript over Python | Better web integration, type safety for complex agent schemas |
| 2026-03-06 | Orchestrator + Specialists over single agent | Clean context windows, independent scaling, mirrors proven Magellan pattern |
| 2026-03-06 | BullMQ over simple cron | Need reliable async execution with retries, priority queues, and job persistence |
| 2026-03-06 | Fastify over Express | Faster, built-in schema validation, native TypeScript support |
| 2026-03-06 | Drizzle over Prisma | Lighter weight, SQL-like API, better for complex queries |
| 2026-03-30 | Per-word ILIKE over phrase ILIKE for document search | Phrase ILIKE requires words to appear contiguously; per-word AND-conditions match documents where all words appear anywhere. Phase 4 upgrade: pgvector cosine similarity once embedding provider is added |
| 2026-03-30 | BullMQ worker concurrency 5→2 | 3+ parallel research tasks each with 10-12 API calls saturates 30K token/min org rate limit. Proper fix (Phase 2): BullMQ built-in rate limiter |
| 2026-03-30 | Document upload: base64 JSON body over multipart | Avoids @fastify/multipart dependency for Phase 1 prototype. Phase 4: replace with proper multipart upload |
| 2026-03-30 | BullMQ worker embedded in server.ts (in-process) | SSE and worker must share the same EventEmitter instance. Two-process model breaks SSE event delivery. Phase 4: extract worker back to separate process and swap EventEmitter for Redis pub/sub. |
| 2026-03-30 | npm run dev:all aliased to npm run dev | Worker now runs in-process; running it separately via concurrently caused duplicate job processing. Single command starts everything. |
| 2026-03-31 | Conductor clarification as stateless frontend stitch (Option A) | No backend session state needed. Frontend accumulates Q&A rounds and sends enriched message on each retry. Max 3 rounds before [FORCE DECOMPOSE] flag. Fits prototype constraint; Phase 4 can upgrade to stateful conversation threading if needed. |
| 2026-04-05 | App-level AES-256-GCM over pgcrypto SQL functions | pgcrypto requires bytea columns + raw SQL, breaking Drizzle ORM. App-level encryption keeps columns as text, works transparently with ORM, and the enc:v1: prefix enables zero-downtime migration of existing plaintext rows. |
| 2026-04-05 | searchDocuments: in-memory decryption over SQL ILIKE | Encrypted ciphertext makes ILIKE meaningless. Fetch all user docs, decrypt in Node, filter by word match. Acceptable at prototype scale; Phase 5 replaces with pgvector cosine similarity anyway. |
| 2026-04-05 | Plaid Link widget deferred (Phase 5) | Full Plaid Link requires @plaidinc/react-plaid-link. Backend Link token + exchange token flow is fully implemented. Frontend PlaidBadge creates a link token to verify the flow; full modal integration deferred to Phase 5 to avoid a large React dependency for what is currently a demo. |
| 2026-04-05 | Stripe webhook rawBody scoped to stripeWebhookRoute plugin | addContentTypeParser moved from global server scope into the stripeWebhookRoute Fastify plugin so the Buffer override only applies to the webhook route. All other routes use the standard JSON parser. |
| 2026-04-05 | node:20-slim (Debian) for production base image | Alpine doesn't support Playwright's pre-built Chromium binaries. Debian slim + npx playwright install --with-deps chromium guarantees the Research Agent browser matches the installed playwright package version. |
| 2026-04-05 | Migration runner compiled to dist/db/migrate.js | drizzle-kit CLI requires tsx in production (reads .ts config). Instead, src/db/migrate.ts uses drizzle-orm/postgres-js/migrator API directly, compiles to JS, and runs before server start in docker-entrypoint.sh. |
| 2026-04-05 | SPA fallback via setNotFoundHandler not GET /* + wildcard:false | @fastify/static with default wildcard:true handles static file serving; unmatched routes fall through to setNotFoundHandler which serves index.html. The GET /* + wildcard:false approach risked route conflicts. |
| 2026-04-05 | Plaid API failure in dag-executor signals plaidConnected:true + empty accounts | Distinguishes "connected but temporarily unavailable" (has token, fetch failed) from "never connected" (no token). Finance Agent gets accurate signal about whether the integration exists. |

---

## Environment Variables

```env
# .env.example — copy to .env and fill in values
ANTHROPIC_API_KEY=
DATABASE_URL=postgresql://user:pass@localhost:5432/concierge
REDIS_URL=redis://localhost:6379
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
PLAID_CLIENT_ID=
PLAID_SECRET=
SESSION_SECRET=
ENCRYPTION_KEY=           # 32-byte hex for document vault encryption
MCP_GMAIL_URL=https://gmail.mcp.claude.com/mcp
MCP_GCAL_URL=https://gcal.mcp.claude.com/mcp
NODE_ENV=development
PORT=3000
```
