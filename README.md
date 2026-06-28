# xevos

> ⚠️ **Project status: Archived (June 2026).** Active development has stopped. xevos
> is paused pending favorable cost and platform conditions — see
> **[PROJECT-CLOSURE.md](./PROJECT-CLOSURE.md)** for the full rationale (platform-automation
> legal risk, official-API economics, and the inference-cost structure of the hierarchy),
> along with the explicit conditions under which it would be revived. The rest of this
> README describes the runtime as it stood at archival.

> **OrgOS** — a runtime for building self-operating, AI-powered companies.

`xevos` is a TypeScript implementation of the **Autonomous Agent Organization (AAO)**
framework: a system for taking a single high-level directive ("research the best
AI startup ideas this quarter" / "build and ship Product X") and pursuing it
autonomously — decomposing it into objectives, delegating work down a hierarchy of
specialized agents, executing with real tools, **verifying its own output against
what was actually done**, and reporting back with the evidence and sources behind
every claim.

**The end goal:** hand a real company to it — codebase, product, customers, brand —
and have it run the operating departments (support, marketing, legal, engineering)
as a **continuous, self-managing loop**, with humans engaged only at the few
high-stakes gates rather than in the day-to-day. The runtime below is the
foundation that goal is being built on; see [Where this is headed](#where-this-is-headed)
for the honest gap between today and that target.

It is built on two hard assumptions:

1. **Agents are stateless, fallible language models, not employees.** They forget
   between calls, occasionally invent facts, have no intrinsic sense of cost, and
   cannot act without tools. Every subsystem exists to compensate for one of those.
2. **Autonomy is the dangerous part.** A company that can spend money, ship code,
   and talk to the outside world without a human in the loop is exactly as risky as
   it is useful. Governance is a first-class layer, not a footnote.

> **Status: working runtime + durable substrate + live dashboard.** The
> organization runs end to end today — a principal talks to the executive, work
> flows down the hierarchy, workers execute with tools, an independent Auditor
> verifies the result against the agent's real actions, and everything streams to
> a web dashboard in real time. State is durable: a single local SQLite database
> backs every store, the event bus persists an audit log and a recoverable work
> queue, and semantic memory recall runs on sqlite-vec. The continuous-operation
> and governance layers (a clock, budgets, approval gates, kill switch) are the
> next milestones — see [Where this is headed](#where-this-is-headed) for the
> honest gap between today and a company that runs itself.

---

## What's in the box

`xevos` is a pnpm monorepo with two packages:

| Package        | What it is                                                                                                                 |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `@xevos/core`  | The runtime: the agent loop, the durable event bus, the role/department model, the tool layer, the stateless Auditor, SQLite/Drizzle persistence, and an HTTP+WebSocket observer. |
| `@xevos/web`   | A Next.js dashboard: a live org-state snapshot, paginated task/message history with real-time deltas, and the principal's chat surface — the org's mission control. |

```
┌────────────────────────────────────────────────────────────────┐
│  GOVERNANCE LAYER   budgets · approval gates · guardrails ·    │  ← designed; in progress
│                     audit log · kill switch                    │
├────────────────────────────────────────────────────────────────┤
│  ORGANIZATION LAYER executive · heads · managers · workers ·   │  ← implemented
│                     the static role ladder                     │
├────────────────────────────────────────────────────────────────┤
│  VERIFICATION       independent stateless Auditor that judges  │  ← implemented
│                     against real tool history & sandbox state  │
├────────────────────────────────────────────────────────────────┤
│  COORDINATION LAYER durable event bus · audit log · inbox     │  ← implemented
│                     queue · direct vs bus tools · escalation   │
├────────────────────────────────────────────────────────────────┤
│  AGENT RUNTIME      the perceive→reason→act→observe loop,      │  ← implemented
│                     one BaseAgent per seat                     │
├────────────────────────────────────────────────────────────────┤
│  SUBSTRATE          SQLite + Drizzle + sqlite-vec · tool       │  ← implemented
│                     registry · Docker sandboxes · model pool   │
└────────────────────────────────────────────────────────────────┘
```

---

## Core ideas

- **Specialization beats generalization.** Each agent gets a narrow charter, a
  focused system prompt, and a small toolset wired from its role and department.
- **Hierarchy is context management.** Managers compress reality: they decompose
  goals into focused tasks on the way down and summarize results into status on
  the way up, so every agent operates on a relevant slice rather than the whole.
  This is what lets the org scale to long-running, multi-team programs that could
  never fit in a single agent's context.
- **Separate the doer from the checker.** Verification is a distinct, independent
  Auditor that sits outside the reporting tree, so shortcuts and hallucinations are
  caught by an agent that didn't produce them.
- **Judge work against what actually happened — not the prose.** The Auditor reads
  the submitter's real tool-call history (and, for code, the real sandbox) and
  checks every claim against it. A cited source that was never retrieved, or output
  that was never produced, fails.
- **Every claim carries its provenance.** Sources flow up the hierarchy unchanged.
  Summaries can be rewritten as they climb; the URLs behind them cannot.
- **Tie autonomy to blast radius.** (Designed.) Reversible, cheap, internal actions
  run autonomously; irreversible, expensive, or external actions require approval.

---

## The agent loop

Every agent — from executive to junior worker — is one `BaseAgent`,
parameterized by a different charter, prompt, and toolset. It owns a mailbox,
blocks on the next event, and each time it wakes it runs one cycle:

1. **Perceive** — the runtime assembles the agent's context: its persisted memory,
   relevant warehouse recall, and the incoming event.
2. **Reason** — a single LLM call decides what to do. Tools are the *only* channel
   an agent communicates through, so every step calls a tool (`toolChoice: "required"`).
3. **Act** — the runtime executes each action. *Direct* tools (create a task, spawn
   a subordinate, edit a file) apply their effect in-process and return the real
   result; *bus* tools (message, escalate, request review) publish a command and the
   outcome arrives later as a correlated event.
4. **Observe** — results are written back to memory, becoming part of the agent's
   context next cycle. The loop ends only when the agent explicitly **yields**
   (`wait_until_response`, `escalate_blocker`, or `request_review`).

---

## Roles & departments

The org is a fixed ladder — each role spawns exactly the role one rung below it,
and identity is **static**: an agent's objective, KPIs, and responsibilities come
from its role, not from the task that spawned it, so it never drifts.

| Role            | Owns                                                       | Spawns      |
| --------------- | ---------------------------------------------------------- | ----------- |
| **Executive**   | The principal relationship; turning intent into objectives | Heads       |
| **Head**        | One department's slice; the *what*, not the *how*          | Managers    |
| **Manager**     | One initiative end-to-end; the spec and decomposition      | Workers     |
| **Worker**      | The actual work, using tools; submits for review           | (leaf)      |

Spawn policy keeps the tree flat and bounded (max depth, per-agent fan-out, and a
global agent ceiling). Departments — `organization`, `engineering`, `research`,
`marketing`, `support`, `sales`, `legal` — decide each agent's toolset and system
prompt. Only **engineering** workers get a Docker sandbox and the full file/bash
toolset; only **research** workers get `web_search`.

---

## Verification & provenance

The hardest part of an autonomous org isn't doing the work — it's *trusting* the
work. `xevos` does this with a standalone, stateless **Auditor** that lives outside
the hierarchy. A worker's `request_review` goes straight to it; it renders a binding
PASS / CHANGES verdict and sends it to the worker's manager (who alone marks tasks
complete).

What makes the verdict trustworthy:

- **Grounded in real actions.** For *every* submission the Auditor pulls the
  submitter's actual tool-call history — the exact searches it ran and the sources
  it really retrieved, the commands it really executed — and checks the report
  against it. Fabricated citations, invented figures, and output that was never
  produced are caught and rejected. This closes the gap where a reviewer could only
  read the pasted prose and had no way to know whether it was real.
- **Ground truth for code.** For an engineering task the Auditor attaches to the
  submitter's sandbox, probes the real filesystem and git state, and re-runs the
  build/tests itself. An empty workspace fails immediately, no matter what the
  evidence claims.
- **Provenance that survives the climb.** Findings are submitted with structured
  **citations** (real title + URL). Those citations propagate **up the org
  unchanged** — workers attach them, managers and heads carry them verbatim, and the
  executive surfaces them to the principal — so any claim can be traced back to the
  exact source it came from instead of dissolving into a summary.
- **Usable web evidence.** `web_search` strips page chrome — nav menus, social-share
  widgets, inline scripts, cookie banners — before returning results, so agents
  reason over real article text and the budget isn't spent on boilerplate.

---

## Persistence & durability

State is the org's single source of truth, and it lives in **one local SQLite
file** — no external database or service to run.

- **SQLite + Drizzle ORM** over `better-sqlite3` (WAL mode) backs every store:
  agents, tasks, per-agent memory, the memory warehouse, prompts, and the
  id-allocation counters. `better-sqlite3` is synchronous, so reads stay sync and
  writes run in real transactions (no lost-update races). Schema lives in
  `packages/core/src/db/schema.ts`; migrations are generated with `drizzle-kit`.
- **Semantic memory recall** uses the **sqlite-vec** extension: archived learnings
  are embedded (`gemini-embedding-001`) and recalled by cosine KNN. Vectors are
  stored raw (un-normalized) so they stay portable to a cloud vector DB later.
- **The event bus is durable.** Every published event is appended to an immutable
  `events` audit log, and every targeted event is written to a per-recipient
  `inbox` queue before delivery. Delivery is at-least-once — an event is acked
  only once the consumer comes back for more work — and `recover()` replays
  anything left unprocessed by a crash on the next start.
- **Hybrid UI sync** keeps the dashboard live without resyncing everything:
  small **org state** (roster, prompts, aggregate stats) is pushed whole on
  connect and on change; **tasks** and **messages** load via paginated HTTP
  (`/tasks`, `/messages`) and then receive only upsert/append deltas; raw events
  stream for the live log.

---

## Core schemas

The data model is a small set of schemas: **Agent**, **Task**, **Memory**, and the
typed **Event** envelopes the bus carries. Every delegation carries acceptance
criteria down; every completion carries evidence — and now sources — up.

```jsonc
// Task — acceptance criteria flow down; verified evidence flows up.
{
  "id": "task_1043",
  "title": "Survey high-potential AI niches",
  "assignedTo": "worker_research_1",
  "acceptanceCriteria": [
    "3–5 niches, each with a documented market gap",
    "every niche backed by ≥2 real, retrieved sources"
  ],
  "status": "in_progress",
  "review": { "auditor": "auditor_service", "verdict": null }
}
```

---

## Getting started

This project uses **pnpm** (Node 24+, TypeScript with `strict` mode, ESM).

```bash
pnpm install        # install dependencies
pnpm dev            # run core + web together (watch mode)
pnpm build          # build every package
pnpm typecheck      # type-check the whole workspace
pnpm test           # run the Node test runner
```

Run a single side if you prefer:

```bash
pnpm core:dev       # just the runtime
pnpm web:dev        # just the dashboard (http://localhost:3000)
```

> **pnpm only** — do not use `npm` or `yarn`.

### Configuration

The runtime reads configuration from the environment (a local `.env` is loaded
automatically):

| Variable                          | Purpose                                                                                      |
| --------------------------------- | -------------------------------------------------------------------------------------------- |
| `GOOGLE_GENERATIVE_AI_API_KEY`    | Single Google Gemini key (the default if no pool is set).                                    |
| `GOOGLE_API_KEYS`                 | Comma-separated pool of keys (each a separate quota bucket) for higher aggregate throughput. |
| `GEMINI_RPM_PER_KEY`              | Per-key requests/minute cap for the rate limiter (default `15`).        |
| `MODEL_MAX_CONCURRENCY`           | Max in-flight model calls at once (defaults to the key count).          |
| `EXA_API_KEY`                     | Enables the `web_search` tool (research workers). Absent → clean tool error. |
| `XEVOS_DB_PATH`                   | SQLite database file (default `./storage/xevos.db`, relative to `packages/core`). |
| `XEVOS_OBSERVER_PORT`             | Port for the observer HTTP + WebSocket server (default `7077`).         |
| `NEXT_PUBLIC_XEVOS_WS_URL` / `…_HTTP_URL` | Where the dashboard connects (defaults point at `127.0.0.1:7077`). |

Engineering workers run inside **Docker** sandboxes, so a running Docker daemon is
required for engineering work. Everything else (including vector search) is
embedded in the single SQLite file — there is no separate database service to run.

### Project layout

```
apps/
  web/                # Next.js dashboard: org snapshot + paginated history + chat
packages/
  core/
    src/
      index.ts        # entrypoint: wires repos, services, bus, observer
      core/
        agents/       # BaseAgent — the one agent, the perceive→act→observe loop
        event-bus/    # durable mailboxes + audit log + inbox queue (SQLite)
        services/     # agent, task, memory, tool, and the Auditor (audit.ts)
        sandbox/      # Docker sandbox for engineering workers
      db/             # Drizzle schema + client (SQLite, WAL, sqlite-vec)
      repositories/   # Drizzle/SQLite-backed Agent / Task / Memory / Prompt stores
      observer/       # HTTP + WebSocket: org snapshot, paginated history, deltas
    drizzle/          # generated SQL migrations
    storage/          # the SQLite database (xevos.db, gitignored)
```

---

## Where this is headed

The destination is a company that runs itself. The honest gap between today and
that goal is one shift and seven pillars.

### The core shift: episodic → continuous

Today the runtime is **reactive and episodic**: the principal sends a directive,
work flows down the hierarchy once, and then every agent parks until the next
message. A real company never "finishes" — it runs on a clock and reacts to the
outside world. So the foundational missing piece isn't a feature, it's a
**heartbeat**: a sense of time, a connection to external events, and standing
objectives that are never "done". Everything below depends on that.

### The seven pillars

1. **Always-on operation** — a scheduler/clock (recurring cadences: support triage,
   standups, marketing reviews), external event ingestion (email, tickets, signups,
   payments, CI failures, alerts → bus events), standing KPI-driven objectives, and
   liveness so no agent parks forever.
2. **Durability** — _done._ The substrate is a single local **SQLite** database
   (Drizzle + sqlite-vec): transactional stores, an append-only event audit log,
   and a recoverable `inbox` queue with at-least-once delivery. The remaining
   hardening is **idempotency keys** on outbound/side-effecting actions so an
   at-least-once replay never double-acts (e.g. sends the same email twice).
3. **Real-world tools** — authenticated connectors per department: support (inbox,
   help desk, KB), marketing (CMS, social, campaigns, analytics), engineering (GitHub,
   CI, deploy, error monitoring — the code sandbox already exists), legal (doc gen +
   review), finance (payments/invoicing).
4. **Brakes & governance** — enforced budgets (token/$/action ceilings), a policy
   layer in front of tools (allowlists, outbound rate limits, content filters), a
   global kill switch, and a persisted, immutable audit log. Today this layer is
   designed but not implemented. **Build the brakes before the gas.**
5. **Quality & self-correction** — extend the grounded Auditor to every department,
   close the loop on outcomes (did the ticket resolve? did the campaign convert?) →
   re-plan → post-mortems, and make memory compound over time.
6. **Owner control plane** — KPI/spend/queue dashboards, alerting for the rare
   escalation, cost monitoring, and an override channel.
7. **Company handoff** — ingest the real company (codebase, product knowledge, brand,
   customer history, legal templates, KPI targets, credentials) behind a company
   brief the executive operates from.

### Phased roadmap

Built bottom-up, substrate first. Done today:

- [x] **Substrate** — event bus, tool registry, memory stores, Docker sandboxes, model pool
- [x] **Core schemas** — Agent, Task, Memory, typed Events
- [x] **Agent runtime** — the perceive→reason→act→observe cycle
- [x] **Role ladder & charters** — executive, heads, managers, workers + per-department prompts
- [x] **Independent verification** — stateless Auditor grounded in real tool history and sandbox state
- [x] **Citation provenance** — structured sources that flow up the org unchanged
- [x] **Durable substrate** — SQLite + Drizzle + sqlite-vec; event audit log + recoverable inbox queue
- [x] **Observability** — HTTP + WebSocket observer with hybrid sync (org snapshot + paginated history + deltas)

Toward a self-running company, in order:

- [ ] **Phase 1 — Idempotency:** dedup keys on outbound/side-effecting actions (the last gap in at-least-once delivery)
- [ ] **Phase 2 — Continuous loop:** scheduler/heartbeat, external event ingestion, standing objectives + KPI tracking
- [ ] **Phase 3 — Governance brakes:** enforced budgets, kill switch, outbound rate limits, policy layer
- [ ] **Phase 4 — First real department (narrow & reversible):** e.g. support email triage with drafted replies, or engineering on GitHub + CI
- [ ] **Phase 5 — Per-department auditing + feedback loops:** outcome measurement, re-planning, post-mortems
- [ ] **Phase 6 — Widen integrations & loosen gates** per the maturity model

### On "no human in the loop"

Be clear-eyed about the dangerous frontier: **fully autonomous *and* able to spend
money, make legal commitments, or send mass public communications** is how an
always-on org does irreversible damage unsupervised. The workable version is not
"remove the human" but "**replace the human gate with hard programmatic policy**"
for low-blast-radius work — strict spend caps, allowlists, rate limits, content
checks — while keeping a thin gate (or absolute hard limits) on the handful of
catastrophic actions. You can realistically reach near-zero human touch on
engineering, drafting, triage, and internal ops long before it is safe on spend,
legal, or mass comms.

Autonomy is therefore grown in three stages, not switched on day one:

1. **Crawl — human-supervised.** Agents propose; humans approve nearly everything.
2. **Walk — human-on-the-loop.** Agents act on reversible/low-stakes work; humans review by exception.
3. **Run — human-in-the-loop for high stakes only.** The org self-corrects; humans engage at high-stakes gates and on strategy.

---

## License

MIT
