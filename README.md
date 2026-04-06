# Agentic Concierge

An AI-powered personal operations agent that executes multi-step life administration tasks end-to-end. You describe what needs to happen — *"find me a better internet plan and draft the cancellation letter"* — and the Concierge researches, compares, drafts, and follows up without you managing the steps.

**Core philosophy:** *I don't want to talk to my computer. I want it to do the work.*

---

## Architecture

The system uses an orchestrator + specialist pattern. A single **Conductor** (Claude Opus 4.6) receives requests, decomposes them into a directed acyclic task graph, routes each node to the right specialist agent, and assembles the final result. Specialists run in isolated contexts with focused tools and never communicate directly with the user.

```
User Request
    │
    ▼
┌─────────────────┐
│    Conductor     │  Claude Opus 4.6
│                  │  Decomposes requests → task graph (DAG)
│                  │  Routes subtasks → specialists
│                  │  Manages approval gates + recovery
└────────┬─────────┘
         │
    ┌────┴──────────────────────────────────────┐
    ▼         ▼          ▼         ▼            ▼
┌────────┐ ┌──────┐ ┌──────┐ ┌────────┐ ┌─────────┐
│Research│ │ Doc  │ │Comms │ │Decision│ │ Finance │
│ Agent  │ │Agent │ │Agent │ │ Agent  │ │  Agent  │
└────────┘ └──────┘ └──────┘ └────────┘ └─────────┘
  Web search  PDF/DOCX  Draft    Weighted   Budget
  Playwright  pgvector  emails   matrices   analysis
  scraping    semantic  scripts  ranked     cost calc
              search    letters  options
```

Every task in the graph carries an **autonomy level**:

| Level | Actions | Approval |
|-------|---------|----------|
| 1 — Auto | Research, read, compare, draft | None |
| 2 — Approve | Send email, submit form, schedule | One-click in the UI |
| 3 — Confirm | Financial transaction, cancel service | Explicit review |

When a specialist can't complete a task, it returns a structured `needs_input` response instead of guessing. The Conductor classifies the gap as researchable (spawns a recovery subtask), user-required (pauses and notifies), or unrecoverable (escalates).

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Runtime** | Node.js 20, TypeScript (strict mode, ESM) |
| **AI** | Anthropic Claude API — Opus 4.6 (Conductor), Sonnet 4.6 (specialists) |
| **API server** | Fastify 5 |
| **Task queue** | BullMQ + Redis 7 |
| **Database** | PostgreSQL 16 + pgvector |
| **ORM** | Drizzle |
| **Auth** | Manual cookie sessions + Google OAuth2 (Arctic) |
| **Web research** | Playwright (Chromium) + DuckDuckGo |
| **Document parsing** | pdf-parse, pdf-lib, mammoth (DOCX) |
| **Billing** | Stripe |
| **Financial data** | Plaid |
| **Real-time** | Server-Sent Events (SSE) |
| **Frontend** | React 18 + Vite 5 + Tailwind CSS |
| **Security** | AES-256-GCM encryption at rest, audit logging, rate limiting |
| **CI/CD** | GitHub Actions → Docker image → ghcr.io |

---

## Features

- **Multi-step workflow execution** — tasks run as a DAG with dependency resolution, retries, and status tracking persisted to PostgreSQL
- **5 specialist agents** — Research, Document, Communications, Decision, Finance — each with focused tools and prompts
- **Clarification flow** — Conductor asks targeted follow-up questions before decomposing ambiguous requests (max 3 rounds)
- **Human-in-the-loop approval queue** — Level 2/3 tasks pause and surface in the UI for one-click approve/reject
- **Workflow resumability** — mid-flight tasks survive server restarts; BullMQ re-enqueues on startup
- **Document vault** — upload PDF/DOCX, extracted text stored with pgvector for semantic search by agents
- **Real-time updates** — SSE streams task status changes to the frontend as they happen; polling fallback when SSE disconnects
- **Session history** — past conversations persisted to localStorage; last 20 sessions browsable
- **Analytics dashboard** — workflow completion rate, task success by agent, avg duration, satisfaction scores
- **Waitlist** — public landing page with email capture backed by a `waitlist_signups` table
- **Google integrations** — Gmail send + Google Calendar create via OAuth2 tokens stored per-user
- **Stripe billing** — checkout session, customer portal, webhook lifecycle handling
- **Plaid financial data** — Link flow (sandbox), account balances, transactions injected into Finance Agent context
- **Multi-tenant** — all data scoped to `userId`; session cookie auth on every protected route
- **Audit logging** — append-only record of auth, approvals, document uploads, and satisfaction feedback

---

## Running Locally

### Prerequisites

- Node.js 20+
- Docker (for PostgreSQL + Redis)
- An [Anthropic API key](https://console.anthropic.com/)
- A Google Cloud project with OAuth2 credentials ([setup guide](https://console.cloud.google.com/))

### 1. Clone and install

```bash
git clone https://github.com/your-username/agentic-concierge.git
cd agentic-concierge

npm install
cd frontend && npm install && cd ..
```

### 2. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in the three required values:

```env
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

Generate an `ENCRYPTION_KEY`:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Everything else (database, redis, Stripe placeholders) is pre-filled.

In Google Cloud Console:
- Add `http://localhost:3000/auth/google/callback` as an Authorized Redirect URI
- Add `http://localhost:5173` as an Authorized JavaScript Origin

### 3. Start infrastructure

```bash
docker compose up -d
```

### 4. Apply database migrations

```bash
npm run db:migrate
```

### 5. Run

Two terminals:

```bash
# Terminal 1 — backend + BullMQ worker (port 3000)
npm run dev

# Terminal 2 — frontend with HMR (port 5173)
cd frontend && npm run dev
```

Open **http://localhost:5173** and sign in with Google.

---

## Project Structure

```
agentic-concierge/
├── src/
│   ├── conductor/          # Orchestrator — request decomposition, DAG execution
│   │   ├── conductor.ts    # Entry point: handleUserMessage()
│   │   ├── decomposer.ts   # Sends to Claude, parses Plan | Clarification response
│   │   └── dag-executor.ts # BullMQ worker, dependency resolution, SSE events
│   ├── agents/             # Specialist implementations
│   │   ├── base-agent.ts   # Shared tool-use loop, retry logic
│   │   ├── research/       # DuckDuckGo + Playwright web research
│   │   ├── document/       # PDF/DOCX parsing + pgvector search
│   │   ├── comms/          # Email, letter, and script drafting
│   │   ├── decision/       # Weighted matrices, ranked recommendations
│   │   └── finance/        # Budget analysis, Plaid account data
│   ├── api/
│   │   ├── server.ts       # Fastify setup, route registration, worker startup
│   │   └── routes/         # chat, workflows, tasks, documents, analytics,
│   │                       # auth, billing, plaid, integrations, waitlist
│   ├── db/
│   │   ├── schema.ts       # Drizzle schema — all tables + enums
│   │   └── migrations/     # SQL migration files (0000 → 0005)
│   ├── integrations/
│   │   ├── google/         # OAuth token management, auto-refresh
│   │   ├── mcp/            # Gmail REST + Google Calendar REST
│   │   ├── stripe/         # Checkout, portal, webhook handling
│   │   └── plaid/          # Link token, exchange, accounts, transactions
│   ├── auth/               # Session management, Google OAuth2 flow
│   ├── context/            # Per-agent context assembly, document vault
│   └── shared/             # Logger, encryption (AES-256-GCM), audit log, types
├── frontend/
│   └── src/
│       └── components/
│           ├── Chat.tsx              # Main interface — clarification flow, SSE, session history
│           ├── WorkflowDashboard.tsx # Task graph visualization, live status, satisfaction feedback
│           ├── ApprovalQueue.tsx     # Level 2/3 task approval UI
│           ├── DocumentVault.tsx     # Document upload and listing
│           ├── AnalyticsDashboard.tsx # Usage metrics, agent performance, satisfaction
│           └── LandingPage.tsx       # Public waitlist page
├── .github/
│   └── workflows/
│       ├── ci.yml          # Typecheck + test + Docker build smoke test
│       └── cd.yml          # Build + push to ghcr.io on main
├── Dockerfile              # Multi-stage: backend-builder → frontend-builder → production
├── docker-compose.yml      # PostgreSQL 16 (pgvector) + Redis 7
└── .env.example
```

---

## CI/CD

**CI** runs on every push and PR:
- TypeScript typecheck (backend + frontend)
- Vitest test suite
- Docker build smoke test (verifies the Dockerfile compiles without pushing)

**CD** runs on every push to `main`:
- Builds the production Docker image
- Pushes to GitHub Container Registry (`ghcr.io`) tagged `latest` and `sha-<commit>`

The production image is a single container that serves the compiled React frontend as static files and runs the Fastify API + BullMQ worker in-process on port 3000.

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Orchestrator + specialists over a single agent | Clean context windows per task, independent specialist prompts, mirrors proven multi-agent patterns |
| BullMQ for task execution | Persistent job queue with retries, priority, and deduplication — workflows survive crashes |
| SSE over WebSocket | Simpler server-side (no connection upgrade), works through proxies, sufficient for unidirectional status updates |
| App-level AES-256-GCM over pgcrypto | Keeps Drizzle ORM compatible; columns stay `text`; `enc:v1:` prefix enables zero-downtime plaintext migration |
| Manual sessions over Lucia Auth | Lucia was deprecated on install; 100-line manual implementation shows auth fundamentals more clearly |
| In-process BullMQ worker | SSE and worker share the same `EventEmitter` — two-process model breaks real-time updates without Redis pub/sub |
| Result pattern over exceptions | Functions that can fail return `{ ok: true, data } \| { ok: false, error }` — no unexpected throws across agent boundaries |

---

## What's Next

- Recovery loop completion — `awaiting_recovery` tasks re-enqueued with enriched inputs after research subtask finishes
- pgvector cosine similarity for document search (currently in-memory word matching)
- Plaid Link modal with full `@plaidinc/react-plaid-link` integration
- SSE event replay for clients that connect after fast tasks complete
- Extract BullMQ worker to a separate process + Redis pub/sub for horizontal scaling
