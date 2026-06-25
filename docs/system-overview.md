# Xevos — Full System Overview

> A complete, ground-truth map of the `xevos` codebase as it exists today: every
> part, what it does, how the pieces fit, and how they communicate. Written from a
> direct read of the source — where the code and the aspirational README diverge,
> this document follows the **code**, and calls out gaps explicitly in
> [§13 Current state & known gaps](#13-current-state--known-gaps).

---

## Table of contents

1. [What xevos is](#1-what-xevos-is)
2. [Repository layout](#2-repository-layout)
3. [Architecture at a glance](#3-architecture-at-a-glance)
4. [The domain model (schemas & IDs)](#4-the-domain-model-schemas--ids)
5. [The communication fabric: EventBus & Mailbox](#5-the-communication-fabric-eventbus--mailbox)
6. [The Principal (human boundary)](#6-the-principal-human-boundary)
7. [The agent runtime: BaseAgent](#7-the-agent-runtime-baseagent)
8. [Services](#8-services)
9. [The tool system](#9-the-tool-system)
10. [The sandbox (engineering workers)](#10-the-sandbox-engineering-workers)
11. [Persistence: the repository layer](#11-persistence-the-repository-layer)
12. [The observer: WebSocket server, protocol & web UI](#12-the-observer-websocket-server-protocol--web-ui)
13. [Current state & known gaps](#13-current-state--known-gaps)
14. [End-to-end walkthroughs](#14-end-to-end-walkthroughs)
15. [Configuration, commands & runtime topology](#15-configuration-commands--runtime-topology)

---

## 1. What xevos is

Xevos ("OrgOS") is a runtime for an **Autonomous Agent Organization (AAO)**: you
hand a single high-level directive to a top-level executive agent, and a hierarchy
of LLM-backed agents decomposes it into objectives, staffs departments, delegates
tasks down a management tree, executes (including real code in a sandbox), reviews
its own output, and reports back to the human.

The implementation is an **actor model**:

- Every agent is the **same** class (`BaseAgent`), parameterized by a charter
  (role + department + objective + tools). It owns a **mailbox**, blocks until an
  event arrives, reasons once with an LLM, and (by design) emits coordination
  events through its tools.
- Agents **never call each other directly**. All coordination flows as typed
  events over a single in-process **`EventBus`**.
- Persistence is **lowdb** JSON files (one process, in-memory bus).
- A read-only **observer** taps the bus and streams to a Next.js dashboard over
  WebSocket.

Two hard assumptions from the README shape the design: agents are *stateless,
fallible* models (hence external memory, structured handoffs), and *autonomy is
the dangerous part* (hence the role hierarchy, sandbox isolation, and an intended
governance/approval layer — much of which is still aspirational).

---

## 2. Repository layout

A **pnpm workspace** monorepo (`pnpm-workspace.yaml` → `packages/*`, `apps/*`),
ESM throughout, TypeScript `strict`.

```
xevos/
├─ package.json            # workspace scripts (core:*, web:*, dev, build, typecheck)
├─ pnpm-workspace.yaml     # packages/* + apps/*
├─ tsconfig.base.json      # ES2022, NodeNext-ish (Bundler resolution), strict
├─ docker-compose.yml      # qdrant (vector DB) — present, not yet wired in
├─ README.md               # aspirational product vision (AAO framework)
├─ docs/
│  ├─ tool-architecture.md # prior design/handoff notes on the tool layer
│  └─ system-overview.md   # ← this document
│
├─ packages/core/          # @xevos/core — the entire backend/runtime
│  ├─ .env                 # GOOGLE_GENERATIVE_AI_API_KEY, XEVOS_OBSERVER_PORT
│  ├─ storage/*.json       # lowdb data files (agents, prompts, memories, …)
│  └─ src/
│     ├─ index.ts          # composition root / entrypoint (main())
│     ├─ core/
│     │  ├─ agents/        # BaseAgent — the one agent class
│     │  ├─ event-bus/     # EventBus + Mailbox
│     │  ├─ principal/     # Principal (human ↔ executive bridge)
│     │  ├─ sandbox/       # DockerSandbox
│     │  ├─ schema/        # Zod schemas + event type definitions (domain model)
│     │  └─ services/      # Agent/Task/Memory/Prompt/Tool services + tool defs
│     ├─ observer/         # ws-server, snapshot builder, wire protocol
│     ├─ repositories/     # lowdb-backed persistence (agent/task/memory/prompt)
│     └─ types/            # tiny shared helpers (Brand<T,B>)
│
└─ apps/web/               # @xevos/web — Next.js 16 observer dashboard ("Principal")
   ├─ app/                 # page, layout, components (dashboard/conversation/panels)
   ├─ lib/                 # use-xevos-stream hook + config
   └─ next.config.ts       # transpiles @xevos/core from source
```

`@xevos/core` exposes two import surfaces (its `package.json#exports`):

- `"."` → `src/index.ts` (the runtime; consumed when run as a process).
- `"./protocol"` → `src/observer/protocol.ts` — a **type-only + tiny-helper**
  surface the browser bundle imports so the web app shares the backend's domain
  types without pulling in Node-only code.

---

## 3. Architecture at a glance

```
                            ┌──────────────────────────────┐
   human "principal"  ───►  │  Principal  (core/principal)  │
   (CLI arg / web UI)       └───────────────┬──────────────┘
                                            │ publish agent/message → executive
                                            ▼
   ┌─────────────────────────────────────────────────────────────────────────┐
   │                          EventBus  (in-process)                           │
   │   • point-to-point: mailboxes keyed by AgentId | ServiceId | "principal"  │
   │   • broadcast: taps (read-only observers) — the observer hooks in here    │
   └───┬───────────────┬───────────────┬───────────────┬────────────────┬─────┘
       │               │               │               │                │
       ▼               ▼               ▼               ▼                ▼
  ┌─────────┐   ┌────────────┐  ┌────────────┐  ┌────────────┐   ┌──────────────┐
  │ BaseAgent│  │AgentService│  │ TaskService│  │(ToolService)│  │   Observer   │
  │  × N     │  │ lifecycle  │  │ task board │  │ exec tools  │  │ WS + snapshot│
  │ mailboxes│  │ create/susp│  │ transitions│  │ (per-call)  │  │   tap        │
  └────┬─────┘  └──────┬─────┘  └──────┬─────┘  └─────────────┘  └──────┬───────┘
       │ reason()      │               │                                │ stream
       ▼ (LLM)         ▼               ▼                                ▼
  ┌──────────────────────────────────────────────┐               ┌──────────────┐
  │  MemoryService · PromptService · ToolService  │               │  Next.js UI  │
  └───────────────────────┬──────────────────────┘               │  (apps/web)  │
                          ▼                                       └──────────────┘
  ┌──────────────────────────────────────────────┐
  │  Repositories (lowdb JSON): agents · tasks ·  │
  │  agent-memories · memory-warehouse · prompts  │
  └──────────────────────────────────────────────┘
```

Mapped onto the README's conceptual stack:

| README layer        | In the code today |
|---------------------|-------------------|
| Governance          | *Mostly aspirational* — budgets/tiers/approval gates defined in types but not enforced |
| Organization        | `role` × `department` hierarchy; `AgentService` lifecycle; `reportsTo`/`manages` |
| Coordination        | `EventBus` + typed events; `TaskService` task board |
| Agent runtime       | `BaseAgent` perceive→reason loop |
| Substrate           | repositories, `MemoryService`, `ToolService`, `DockerSandbox`, observer |

---

## 4. The domain model (schemas & IDs)

All domain types live in `core/schema/`. The pattern is **Zod schema → inferred
type**. IDs are **branded template-literal strings** validated by Zod, which is
how the system encodes structure into identifiers.

### 4.1 Identity (`agent.schema.ts`, `event/base-event.ts`, `task.schema.ts`)

| ID type | Shape | Meaning |
|---|---|---|
| `Role` | `"executive" \| "head" \| "manager" \| "worker"` | Authority level |
| `Department` | `organization, engineering, product, design, marketing, sales, finance, legal, support, research` | Org unit |
| `AgentId` | `` `${Role}_${Department}_${number}` `` | e.g. `head_engineering_1` |
| `RoleDefinitionId` | `` `${Role}_${Department}` `` | counter key for ID minting |
| `PrincipalId` | `"principal"` (literal) | the human boundary |
| `ReportTargetId` | `AgentId \| "principal"` | who an agent reports to |
| `TaskId` | `` `task_${number}` `` | tasks |
| `MemoryWarehouseId` | `` `memory_${number}` `` | archived learnings |
| `EventId` | `` `event_${number}` `` | one per published event |
| `ServiceId` | `` `${string}_service` `` | service mailboxes |
| `EndpointId` | `AgentId \| ServiceId \| PrincipalId` | anything addressable on the bus |

### 4.2 Agent (`agent.schema.ts`)

```ts
Agent = {
  id, role, department, createdAt,
  objective: string,
  kpis: string[], responsibilities: string[],
  status: "active" | "suspended",
  reportsTo: AgentId | "principal",
  manages: AgentId[],
  tools: string[],          // tool names granted to this agent
}
```

- `AgentCreate` = the subset a creator supplies (`role, department, objective,
  kpis, responsibilities, reportsTo, tools, manages, status`). `id` and
  `createdAt` are minted by the repository.

### 4.3 Task (`task.schema.ts`)

```ts
Task = {
  id, status, title, description,
  acceptanceCriteria: string[],
  dependencies: TaskId[],
  referceTask: TaskId[] | null,      // (sic — typo for "reference")
  review: { reviewer, verdict: "approved"|"changes_requested", notes } | null,
  assignedTo: AgentId | null,
  priority: "low"|"normal"|"high"|"urgent",
  deadline: number | null,
  budget: { maxTokens, maxUsd },     // defined, NOT enforced
  createdAt, updatedAt,
}
```

- `TaskStatus` = `backlog, assigned, in_progress, blocked, in_review, completed,
  failed, cancelled`.
- `ClosedReason` = `completed | failed | cancelled` (the terminal states).
- `MutableTask` = the fields a transition/update may change
  (`status, review, assignedTo, priority, deadline`).
- `TaskCreate` = what a creator supplies (no `id/status/timestamps`).

The legal state machine lives in **`TaskService`** (`VALID_TRANSITIONS`), not the
schema — see §8.2.

### 4.4 Memory (`memory.schema.ts`)

- `AgentMemory = { agentId, messages: ModelMessage[], updatedAt }` — an agent's
  rolling conversation transcript (AI-SDK `ModelMessage`s).
- `MemoryWarehouse = { id, taskId, agentId, outcome: ClosedReason, learning,
  messages, createdAt }` — a **closed task's** distilled record.
- `Learning = { summary, keyFindings[], decisions[], lessonsLearned[] }` —
  extracted by an LLM at task close (see §8.3).

### 4.5 Events (`schema/event/*`)

The full set of coordination messages. Every event extends `BaseEvent`
(`id, source, target, correlationId?`) and carries `topic` + `type` + `body`.
`Event = AgentEvent | TaskEvent`.

**Agent topic** (`event/agent.ts`):

| `type` | body | emitted by | handled by |
|---|---|---|---|
| `message` | `{ content }` | `send_message`, Principal | target agent's mailbox |
| `task_delegation_request` / `_response` | `{ taskId }` / `{ taskId, accepted, reason }` | `assign_task` | target agent |
| `approval_request` / `_response` | `{ action, reason }` / `{ approved, reason }` | *(no tool yet)* | — |
| `information_request` / `_response` | `{ query }` / `{ answer }` | `request_information` | target agent |
| `escalation_request` / `_response` | `{ reason, blockedTaskId }` / `{ solution, blockedTaskId }` | `escalate_blocker` | `reportsTo` |
| `review_presentation_request` / `_response` | `{ summary, taskId }` | `request_review` | `reportsTo` |
| `agent_creation_request` / `_response` | `AgentCreate` / `{ approved, agentId, reason }` | `create_subordinate_agent` | **AgentService** |
| `agent_suspension_request` / `_response` | `{ agentId, reason }` / `{ approved, reason }` | *(no tool yet)* | **AgentService** |
| `agent_resume_request` / `_response` | `{ agentId }` / `{ resumed, reason }` | *(no tool yet)* | **AgentService** |
| `agent_termination_request` / `_response` | `{ agentId, reason }` / `{ terminated, reason }` | *(no tool yet)* | **AgentService** |

**Task topic** (`event/task.ts`):

| `type` | body | emitted by | handled by |
|---|---|---|---|
| `task_create_request` / `_response` | `TaskCreate` / `{ taskId, created, reason }` | `create_task` | **TaskService** |
| `task_update_request` / `_response` | `{ taskId, patch }` / `{ updated, reason }` | *(no tool yet)* | **TaskService** |
| `task_transition_request` / `_response` | `{ taskId, to, note }` / `{ transitioned, reason }` | `update_task_status` | **TaskService** |

`EventRes<T> = Omit<T, "id" | "source">` — the shape a handler returns; the
publishing helper fills in `source` and the bus mints `id`.

> **Request/response convention:** there is no built-in correlation enforcement.
> `BaseEvent.correlationId` exists but is not currently populated. Replies are
> matched only by `target` (the original `source`) and human/LLM interpretation.

---

## 5. The communication fabric: EventBus & Mailbox

`core/event-bus/index.ts`. This is the spine of the whole system.

### 5.1 Mailbox

A **single-consumer async queue**:

- `push(event)` — if a consumer is parked in `takeNext()`, hand the event
  straight to it; otherwise enqueue.
- `takeNext(): Promise<Event>` — return a queued event, or park a single waiter
  resolver. **Throws if a second consumer parks** (`"Mailbox already has a
  pending consumer"`). This is the structural reason each endpoint is consumed by
  exactly one loop.

### 5.2 EventBus

- **Mailboxes** keyed by `SubscriptionId = AgentId | ServiceId | EndpointId`.
  `subscribe(id)` creates one; `unsubscribe(id)` drops it.
- **Taps** (`tap(observer) → dispose`): read-only broadcast observers notified on
  *every* publish. The observer/WebSocket layer is the only tap. Tap exceptions
  are caught and logged — a misbehaving observer can never break delivery.
- `publish(event)`:
  1. mints `id = ` `` `event_${Date.now()}` `` (note: time-based, see gaps),
  2. **point-to-point**: pushes to `mailboxes.get(event.target)` *if it exists*,
  3. **broadcast**: calls every tap,
  4. returns the `EventId`.

**Key delivery semantics:**

- Delivery is **fire-and-forget to a single target mailbox**. If the target has
  no mailbox (e.g. `target: "principal"`, which never subscribes), the event is
  delivered **only to taps** — this is exactly how agent→principal replies become
  visible to the UI without a principal mailbox (see §6).
- There is **no topic/broadcast subscription** for agents; everything is addressed.
- Ordering is the natural enqueue order; there is no priority.

---

## 6. The Principal (human boundary)

`core/principal/index.ts`. A thin bridge between the human and the executive
agent. `Principal.id = "principal"`.

- `send(content)` → publishes `agent/message` with `source: "principal"`,
  `target: executiveId`. This is how a directive enters the system (from the CLI
  arg in `main()`, or from the web UI via the observer's `onPrincipalMessage`).
- `receive(from, message)` → called out-of-band by the `respond_to_principal`
  tool (via a `principalSink` callback). It logs the reply and **re-publishes** it
  onto the bus as `agent/message` with `target: "principal"`. Since the principal
  has no mailbox, that event is delivered **only to taps**, making the reply
  visible in the dashboard's conversation pane.

So the human↔executive channel is: **directive in** via a real mailbox delivery;
**reply out** via a tap-only "echo" event.

---

## 7. The agent runtime: BaseAgent

`core/agents/index.ts`. **The one and only agent class.** Executive, head,
manager, and worker are all `BaseAgent` — they differ only by their `config`
(role/department/tools/prompts) and a single `if`.

### 7.1 Construction & the single `if`

```ts
new BaseAgent(config, bus, memory, tools, prompts, tasks)
```

- Subscribes a mailbox for `config.id`.
- **The only specialization:** if `role === "worker" && department ===
  "engineering"`, it constructs a `DockerSandbox({ name: config.id })`. That single
  fact is what makes one agent a "coding agent": it gets a container, and the tool
  registry therefore hands it filesystem/bash tools. There is no separate worker
  class.

### 7.2 The loop (`start` → `run` → `handle`)

```
run():  while running:
          event = await mailbox.takeNext()       # block until addressed
          if config.status !== "active": skip
          handle(event)  (errors → onError)

handle(event):
   if sandbox: prepareSandbox()                  # one-time: start container + branch
   context     = memory.assembleContext(config, event)   # prior messages + warehouse hits
   newMessage  = prepareMessage(event)           # render the event as a user turn
   messages    = [...context, newMessage]
   responses   = reason(messages)                # the LLM call
   memory.recordTurn(config, [newMessage, ...responses])
```

- **`prepareMessage`** turns an incoming event into a `user` `ModelMessage`. Task
  delegations are expanded into a readable brief (title, description, acceptance
  criteria, fetched from the `TaskRepository`); everything else is rendered as
  ``[topic/type]\nFrom <source>: <JSON body>``.
- **`reason`** calls the AI-SDK `generateText`:
  - `model = getModel(department, role)` (see §8.6),
  - `system = prompts.buildSystemPrompt(config)`,
  - `tools = tools.getTools(config, sandbox)` — **executable** tools (each carries
    its handler as `execute`, see §9),
  - `toolChoice: "required"` — the model must pick a tool each turn,
  - `stopWhen: stepCountIs(sandbox ? WORKER_MAX_STEPS : 1)` — a sandbox-backed
    worker iterates (reason→act→observe) up to 30 steps; every other agent takes
    **one decisive action per event**,
  - returns `result.response.messages` — which now already contains the assistant
    tool-call message **and** the tool-result messages, because the tools ran
    in-loop.

> **Tools execute in-loop (no separate dispatch).** Because `getTools` binds each
> handler as the tool's `execute` (§9), `generateText` runs the effect itself —
> publishing the coordination event or driving the sandbox — and feeds the result
> back to the model for the next step. `handle()` simply records
> `result.response.messages`; there is no manual tool-call extraction and no
> second round-trip through a standalone executor for the model's own calls. Tool
> execution is therefore **local to the agent's reasoning loop**.

### 7.3 Sandbox preparation & error path

- **`prepareSandbox`** (idempotent, code-driven so it can't be skipped by the
  model): start the container, ensure a git repo, set git identity, and check out
  a branch **named after the agent id**. Branch isolation is guaranteed in code.
- **`onError`** (the one place the executor is used): on any unhandled error it
  invokes `tools.execute(config, { toolName: "escalate_blocker", … })` to raise an
  `escalation_request` to its supervisor.

---

## 8. Services

All services are long-lived loops subscribed to a `ServiceId` mailbox. They are
wired together in `src/index.ts#main()` (the composition root).

### 8.1 AgentService (`services/agent.ts`, `agent_service`)

Owns the **agent lifecycle** and the live `BaseAgent` instances (`Map<AgentId,
BaseAgent>`).

- On construction it **launches every `active` agent** from the repository (on a
  fresh DB that's just the seeded CEO).
- Consumes `agent`-topic lifecycle events and responds:
  - **`agent_creation_request`** → validates the creator exists and may create
    subordinates (`SUBORDINATE_ROLE`: executive→head→manager→worker→∅). The new
    agent's department is the creator's (or, for the executive, the requested
    department). Mints the agent via the repo, grants it `toolNamesFor(role,
    department)`, updates the creator's `manages`, launches it, and replies
    `agent_creation_response`.
  - **`agent_suspension_request`** → set status `suspended`, reply.
  - **`agent_resume_request`** → set status `active`, relaunch, reply.
  - **`agent_termination_request`** → stop & drop the instance, delete from repo,
    reply.
- `SUBORDINATE_ROLE` encodes the **only legal staffing direction**: each role can
  create exactly the role one rung below.

### 8.2 TaskService (`services/task.ts`, `tasks_service`)

Owns the **task board** and its state machine.

- **`task_create_request`** → `tasks.createTask(body)`, reply with the new
  `taskId`.
- **`task_transition_request`** → look up the task; reject illegal transitions
  using `VALID_TRANSITIONS`; on a legal move it updates status, and if the task is
  unassigned and the mover is an agent transitioning to `assigned`/`in_progress`,
  it auto-assigns the task to that agent. Reply with `transitioned`.
- **`task_update_request`** → patch mutable fields, reply.
- **Archival:** whenever a task reaches a terminal state (`completed/failed/
  cancelled`), it calls `memory.closeTask(...)` for the assignee (distill +
  archive — see §8.3).

`VALID_TRANSITIONS` (the real state machine):

```
backlog     → assigned | cancelled
assigned    → in_progress | blocked | cancelled
in_progress → blocked | in_review | completed | failed | cancelled
blocked     → in_progress | cancelled | failed
in_review   → in_progress | completed | failed | cancelled
completed | failed | cancelled → (terminal)
```

### 8.3 MemoryService (`services/memory.ts`, `memory_service`)

The agent memory subsystem. Backed by three repos (`task`, `agentMemory`,
`memoryWarehouse`). Uses **BM25** (`fast-bm25`) for retrieval — no vector DB yet.

- **`assembleContext(agent, event)`** → load the agent's rolling `messages`; if a
  warehouse-context system message isn't already present, build a search query
  from the triggering event (`buildSearchQuery`), BM25-search the warehouse, and
  prepend a `system` message containing the top hits. This is the agent's
  "perceive" step.
- **`recordTurn(agent, messages)`** → append messages to the agent's memory.
- **`recall(query, limit=5)`** → BM25 search over warehouse learnings (this is
  what the `search_memory` tool calls).
- **`closeTask(agent, taskId, reason, summary?)`** → build a transcript of the
  task + the agent's messages, call `extractLearning` (an LLM call returning the
  structured `Learning` via `Output.object`), then **clear the agent's working
  memory** and **archive** a `MemoryWarehouse` entry. This is the
  forget-the-details / keep-the-lesson mechanism.
- BM25 ranks over four boosted fields of each learning (`summary` ×2, `findings`
  ×1.5, `decisions`, `lessons`).

### 8.4 PromptService (`services/prompt.ts`, `prompts_service`)

Builds an agent's **system prompt** by composition:

```
[Role Instructions]        ← prompts.getRolePrompt(role)
[Department Instructions]  ← prompts.getDepartmentPrompt(department)
[Agent Profile]            ← id / role / department
[Objective]                ← agent.objective
[Responsibilities]         ← bullets (if any)
KPIs                       ← bullets (if any)
Reporting Structure        ← "You report to <reportsTo>." (if any)
[Management Responsibilities] ← the agents it manages (if any)
Available Tools            ← agent.tools as a bullet list
```

The role/department prompt **text** comes from the `PromptRepository`, seeded from
`repositories/prompt/default-prompts.ts` (`ROLE_PROMPTS`, `DEPARTMENT_PROMPTS`).
Those defaults are where the real behavioral instructions live (e.g. the
engineering-department prompt documents the sandbox tools and the
append-only-git / iterate-until-green workflow).

### 8.5 ToolService (`services/tool/service.ts`, `tool_service`)

The facade over the tool layer (detailed in §9). Two methods:

- `getTools(agent, sandbox?)` → an AI-SDK `ToolSet` of **executable** tools for
  `reason()`. It asks `ToolRegistry.resolve` which definitions the agent gets,
  builds a per-agent `ToolContext`, and binds each handler as that tool's
  `execute`. So the tools the model receives run their own effect in-loop.
- `execute(agent, toolCall)` → run a tool's `handler` **out of band** via
  `ToolExecutor` — used only for programmatic forced actions (the `onError`
  auto-escalation), not the model's own calls.
- Constructed with a `principalSink` callback (wired in `main()` to
  `Principal.receive`) so `respond_to_principal` can reach the human.

### 8.6 Model selection (`core/utils.ts`)

`getModel(department, role)` → a Google Gemini model per role. Currently:
executive → `gemini-flash-lite-latest`, head → `gemini-flash-latest`, manager &
worker → `gemini-flash-lite-latest` (department is ignored; `manager` falls
through to `worker` by an intentional-looking empty case).

---

## 9. The tool system

`core/services/tool/`. This is how an agent *acts*. A "tool" here is split into
**two halves** that travel together in a `ToolDefinition`:

```ts
ToolDefinition<TName, TInput> = {
  name:    TName,                 // the literal tool name
  tool:    Tool,                  // AI-SDK tool = { description, inputSchema } ONLY
  handler: (ctx: ToolContext, input) => ToolResult | Promise<ToolResult>,
}
```

- **`tool`** is what the model sees (schema + description) — it has **no
  `execute`**.
- **`handler`** is the effect, run with a `ToolContext = { agent, bus, memory,
  tasks, principalSink }`. Most handlers just **publish an event** (via the
  `publish(bus, event)` helper, which returns `{ success, result: { eventId } }`).

### 9.1 Granting tools (`default-tools.ts`)

Tools are granted by **role**, plus a (currently empty) per-department worker list:

```
BASE_TOOLS        = request_information, escalate_blocker, search_memory,
                    send_message, update_task_status, wait_until_response,
                    get_status, web_search
MANAGEMENT_TOOLS  = create_task, assign_task, create_subordinate_agent, …BASE
ROLE_TOOLS = {
  worker:    [request_review, …BASE],
  manager:   [...MANAGEMENT],
  head:      [...MANAGEMENT],
  executive: [respond_to_principal, ...MANAGEMENT],
}
DEPARTMENT_WORKER_TOOLS = { every department: [] }   # reserved, currently empty
toolNamesFor(role, dept) = ROLE_TOOLS[role] ⧺ DEPARTMENT_WORKER_TOOLS[dept]
```

`toolSet` is a name→definition map built from the `definitions` array.

### 9.2 Resolution (`registry.ts`) & execution (`executor.ts`)

- **`ToolRegistry.getTools(agent, sandbox?)`** → for each granted name, take the
  static `.tool` (schema only). If the agent has a sandbox, **additionally** add
  the 9 sandbox code tools (`codingTools(sandbox)`). Returns an AI-SDK `ToolSet`.
- **`ToolExecutor.execute(agent, toolCall, sandbox?)`** → look the tool up in
  `createDefinitionMap(sandbox)`, build the `ToolContext`, and run `.handler`.
  Errors are caught and returned as `{ success: false, error }`.

> The registry feeds `generateText` (schema-only tools); the executor runs
> handlers. **These two paths are not connected in `reason()`** — only `onError`
> calls the executor today. See §13.

### 9.3 The definitions (`definitions/`)

`definitions = [...agentDefinitions, ...taskDefinitions]` (13 static). Code tools
are factories requiring a sandbox, added separately. `ToolName` is the union of
all names. `createDefinitionMap(sandbox?)` returns the lookup map (13 without a
sandbox, 22 with).

**Agent tools** (`definitions/agent/`) — coordination verbs, mostly publish one event:

| tool | input | effect |
|---|---|---|
| `assign_task` | `taskId, agentId, rationale` | publish `task_delegation_request` → `agentId` |
| `send_message` | `agentId, content, rationale` | publish `message` → `agentId` |
| `request_information` | `agentId, query, rationale` | publish `information_request` → `agentId` |
| `escalate_blocker` | `reason, blockedTaskId?, rationale` | publish `escalation_request` → `reportsTo` (error if none) |
| `request_review` | `taskId?, summary, rationale` | publish `review_presentation_request` → `reportsTo` |
| `create_subordinate_agent` | `agentCreateSchema` | publish `agent_creation_request` → `agent_service` |
| `search_memory` | `query, rationale` | `memory.recall(query)` → returns results (no event) |
| `get_status` | `rationale` | returns `{ agent, agentStatus, tasks: listByAgent(...) }` (no event) |
| `respond_to_principal` | `message, rationale` | `principalSink(agentId, message)` → reaches the human |
| `wait_until_response` | `rationale` | no-op, returns `{ status: "idle" }` |
| `web_search` | `query, rationale` | **stub** → `{ success:false, error:"web search is not connected yet" }` |

**Task tools** (`definitions/task/`):

| tool | input | effect |
|---|---|---|
| `create_task` | `taskCreateSchema` | publish `task_create_request` → `tasks_service` (defaults `budget={maxTokens:50_000,maxUsd:1}`) |
| `update_task_status` | `taskId, newTaskStatus, rationale` | publish `task_transition_request` → `tasks_service` (`note:null`) |

**Code tools** (`definitions/code/`) — only granted to a sandboxed (engineering
worker) agent; each is a `(sandbox) => ToolDefinition` factory. All output is
clipped to 30,000 chars (`zutils.clip`):

| tool | what it does (via `DockerSandbox`) |
|---|---|
| `bash` | `sandbox.exec(command, cwd?)`; returns exit/stdout/stderr |
| `read_file` | `sandbox.readFile`; returns content with line numbers |
| `write_file` | refuses to clobber unless `overwrite`; `sandbox.writeFile` |
| `edit_file` | read → unique-match `old_string` (or `replace_all`) → write |
| `multi_edit` | read once → apply N sequential edits in memory → write once |
| `insert` | insert before/after a unique anchor (or prepend/append) |
| `list_dir` | `ls -la` |
| `glob` | `shopt -s globstar nullglob; printf '%s\n' <pattern>` |
| `grep` | `grep -rnE -- <pattern> <path> \| head -200` |

`zutils.assertAllowed` defines an **append-only git allowlist** (`init, config,
status, add, commit, diff, log, show, rev-parse, ls-files, branch, blame,
describe, shortlog, cat-file`) — blocking `reset/checkout/push/rebase/--amend`.
(The engineering department prompt tells the model these rules; enforcement via
`assertAllowed` is available in `zutils` for the `bash` tool to call.)

---

## 10. The sandbox (engineering workers)

`core/sandbox/docker-sandbox.ts`. A **persistent Docker container** that is the
resource binding for an engineering worker.

- Constructed with `{ name: agentId, image = "node:24-slim", workdir =
  "/workspace" }`. The container name **doubles as the git branch name**.
- `start()` — idempotent: reuse a running container, resume a stopped one, or
  `docker run -d … sleep infinity` a fresh one. So a worker's session **survives
  across runs**.
- `exec(command, cwd?)` runs `docker exec -w <cwd> <name> bash -lc <command>`.
  `readFile`/`writeFile` are `cat`/`cat >` wrappers. `stop()` halts without
  deleting (resumable); `remove()` deletes.

This is "computer use" scoped to an isolated container — the unit of work is
*iterate-until-green*, never run on the host.

---

## 11. Persistence: the repository layer

`repositories/`. Storage is **lowdb** (`JSONFilePreset`) — each repo owns one JSON
file under `packages/core/storage/`. `ensureStorageFile` creates the parent dir
before the first write. All repos load the whole file into memory and `write()`
the whole file on mutation.

| Repository | File | Holds | Notable behavior |
|---|---|---|---|
| `AgentRepository` | `agents.json` | `{ counters, agents[] }` | `create()` **seeds the CEO** (`DEFAULT_AGENT`) if absent; mints `AgentId` from per-`RoleDefinitionId` counters; `getCEO()`; many `listBy*` |
| `TaskRepository` | `tasks.json` | `{ nextTaskId, tasks[] }` | `createTask` mints `task_<n>`, defaults `status:"backlog"`, `review/assignedTo:null` |
| `AgentMemoryRepository` | `agent-memories.json` | `{ agentMemories[] }` | `get/append/clear` an agent's rolling messages |
| `MemoryWarehouseRepository` | `memory-warehouse.json` | `{ counter, warehouse[] }` | `archive` mints `memory_<n>`; `listBy{Agent,Task,Outcome}` |
| `PromptRepository` | `prompts.json` | `{ roles, departments }` | `create()` **seeds defaults** for every role & department; get/save per role/dept |

`DEFAULT_AGENT` (the seeded CEO) is `executive` / `organization`, `reportsTo:
"principal"`, granted `ROLE_TOOLS.executive`. The current `storage/agents.json`
shows exactly one agent: `executive_organization_1`.

> **Access pattern note:** several reads are *synchronous* (`AgentRepository.get/
> list/getCEO`, `PromptRepository.get*`) because lowdb holds everything in memory.
> This is why services can read agents synchronously in hot paths (e.g.
> `PromptService` resolving `manages`, `TaskService.isAgent`).

---

## 12. The observer: WebSocket server, protocol & web UI

The read-only window into the running org. **Nothing here affects coordination** —
it's a pure tap plus an HTTP snapshot.

### 12.1 Wire protocol (`observer/protocol.ts`)

A versioned, **type-only** module (safe for the browser bundle via
`@xevos/core/protocol`). `PROTOCOL_VERSION = 1`.

- **`Snapshot`** = full state at connect time: `{ protocolVersion, capturedAt,
  throughSeq, agents, tasks, prompts, memoryWarehouse }`.
- **Server → client frames:** `SnapshotFrame { kind:"snapshot", data }` and
  `EventFrame { kind:"event", event }`, both carrying `v/seq/ts`.
- **Client → server:** `PrincipalMessageFrame { kind:"principal_message",
  content }`.
- Parse/guard helpers validate only the envelope (version + discriminant), not the
  trusted domain payload. Re-exports the domain types the UI needs.

### 12.2 Server (`observer/ws-server.ts`)

`startObserverServer({ bus, sources, port, onPrincipalMessage })`:

- HTTP: `GET /health` (liveness + client count), `GET /snapshot` (full snapshot as
  JSON, for SSR/debug).
- WebSocket on `/ws`: on connect it captures `bus.publishedCount` **before**
  building the snapshot (so the snapshot can only over-count, never miss an event),
  sends a `SnapshotFrame`, then replays any events observed during the handshake
  whose seq is past the boundary — closing the snapshot↔subscribe gap without loss
  or duplication.
- A **single bus tap** fans out every event to all ready clients (buffering
  per-client until each is ready).
- Inbound `principal_message` frames are routed to `onPrincipalMessage` (wired to
  `Principal.send` in `main()`).
- `buildSnapshot(sources, meta)` (`observer/snapshot.ts`) assembles the snapshot
  from the live repositories.

### 12.3 Web UI (`apps/web`)

Next.js 16 + React 19 + Tailwind. A single dashboard ("Xevos Principal").

- **`lib/config.ts`** — endpoints: `WS_URL` (default `ws://127.0.0.1:7077/ws`, env
  `NEXT_PUBLIC_XEVOS_WS_URL`) and `SNAPSHOT_URL` (default
  `http://127.0.0.1:7077/snapshot`, env `NEXT_PUBLIC_XEVOS_SNAPSHOT_URL`); plus
  `MAX_FEED=500`, `REFRESH_DEBOUNCE_MS=250`, `RECONNECT_DELAY_MS=1500`.
- **`lib/use-xevos-stream.ts`** — the one hook. Opens the WebSocket, parses frames
  with `parseServerFrame`, and maintains a reducer state:
  - `snapshot` — replaced wholesale on each `SnapshotFrame` (drives the structured
    panels).
  - `feed` — newest-first rolling list of `{ seq, ts, event }`, capped at 500
    (drives the conversation + live feed).
  - `status` (`connecting|open|closed`), `received`, `lastError`.
  - When a **store-mutating** event arrives (`task_*_response`, `agent_*_response`),
    it **re-fetches the HTTP snapshot** (debounced 250 ms) so the panels stay
    current. Auto-reconnects after 1500 ms on close.
  - `sendMessage(content)` wraps content in a `principalMessageFrame` and sends it
    over the open socket (returns `false` if not connected; no queueing).
- **`app/page.tsx`** → renders `<Dashboard/>`.
- **`components/dashboard.tsx`** → header (status badge, event count, snapshot
  time) + a 3-column grid: `Conversation` | (`OrgPanel` + `PromptsPanel`) |
  (`TaskBoard` + `EventFeed`).
- **`components/conversation.tsx`** → derives principal↔executive messages from the
  feed (filtering `message` events touching `"principal"`), renders a chat with a
  textarea wired to `sendMessage`.
- **`components/panels.tsx`** → `OrgPanel` (agents grouped by department),
  `TaskBoard` (kanban by status), `PromptsPanel` (role/department prompt keys),
  `EventFeed` (newest-first raw event stream).

**Reactivity model:** *snapshot = structured/current state; feed = live immutable
event tail.* Panels render the snapshot; conversation/feed render the stream;
store-mutating events trigger a debounced snapshot refresh.

---

## 13. Current state & known gaps

Facts about the code as it stands (not aspirations). These matter for anyone
extending the system.

1. **Tool effects don't fire in the happy path (the big one).** `reason()` gives
   `generateText` tools with **no `execute`**, and does not dispatch the returned
   tool-calls to `ToolExecutor`. So an agent *decides* on a tool every turn, the
   decision is recorded in memory, but the **event is never published** (and
   sandbox commands never run) — except `escalate_blocker`, which `onError`
   dispatches directly. **To make the org actually run, `BaseAgent` must execute
   the model's tool-calls** (loop the tool-call parts through `tools.execute`, or
   give each `tool` an `execute` that closes over the per-agent `ToolContext`).
   `WORKER_MAX_STEPS`/`stopWhen` are scaffolded but commented out, so even the
   worker multi-step loop is single-turn today.
2. **Governance is mostly types, not enforcement.** Autonomy tiers, approval
   gates, the kill switch (README §Governance) are not implemented. `Task.budget`
   exists and `create_task` sets a default, but **nothing enforces it**.
3. **No spawn policy.** `agent_creation_request` is validated only for
   role-direction; there is no cap on how many subordinates can be created →
   unbounded growth.
4. **Several events have no emitting tool yet:** `approval_request`,
   `agent_suspension/resume/termination_request`, `task_update_request`. The
   handlers exist; the verbs to trigger them don't.
5. **`web_search` is a stub.** Returns "not connected yet".
6. **Qdrant is provisioned but unused.** `docker-compose.yml` runs Qdrant and
   `@qdrant/js-client-rest` is a dependency, but memory retrieval uses **BM25**
   only.
7. **Single-consumer `Mailbox`.** Parking a second consumer throws. Fine for the
   one-loop-per-endpoint design, but a constraint to remember.
8. **`EventId` is time-based** (`event_${Date.now()}`): events published in the
   same millisecond collide on id, and `protocol.eventSeq` treats the id as a
   sequence number. The observer's gap-closing logic leans on monotonic ids.
9. **Schema typo:** `Task.referceTask` (should be `referenceTask`).
10. **`getModel` ignores department** and routes manager→worker via a fall-through.
11. **`docs/tool-architecture.md` is partly stale** — it predates the current
    `ToolRegistry`/`createDefinitionMap` wiring (which now exists) and the
    `create_subordinate_agent` collapse (which is done). Its *conceptual* analysis
    (verbs vs. resources, sandbox-for-stateful-work, profiles axis) is still the
    live design direction.

---

## 14. End-to-end walkthroughs

### 14.1 Boot (`src/index.ts#main`)

1. Load `.env`; create all five repositories in parallel (seeding the CEO and the
   default prompts on first run).
2. `executive = agentRepo.getCEO()`.
3. Construct `EventBus`, `MemoryService`, `PromptService`, `Principal(bus,
   executive.id)`, `ToolService` (with `principalSink → principal.receive`),
   `TaskService`, `AgentService`. Constructing `AgentService` **launches the
   active agents** (the CEO) — each `BaseAgent.start()` begins blocking on its
   mailbox.
4. `taskService.start()` and `agentService.start()` begin their consume loops.
5. `startObserverServer(...)` taps the bus and serves the snapshot/WS on the
   observer port (default `7077`).
6. The directive (CLI args, or a default "stand up the organization" prompt) is
   sent: `principal.send(directive)` → `agent/message` → the CEO's mailbox.

### 14.2 Intended coordination flow (once tool dispatch is wired — see §13.1)

```
principal.send("Launch product X")
  → agent/message → executive mailbox
    → executive.reason() picks create_subordinate_agent(head, …)
      → agent_creation_request → agent_service
        → AgentService mints head_product_1, grants tools, launches it
        → agent_creation_response → executive
    → executive delegates: assign_task / send_message → head
      → head decomposes → create_subordinate_agent(manager) → … → create_task
        → task_create_request → tasks_service → TaskService mints task_1
      → manager assign_task(task_1, worker) → task_delegation_request → worker
        → worker.prepareMessage expands the task brief
        → (engineering worker) prepareSandbox(): container + branch
        → worker iterates with bash/edit_file/… in its sandbox
        → worker update_task_status(in_review) + request_review → manager
          → task_transition_request → tasks_service (state machine guards it)
      → manager reviews; on terminal status TaskService.archive →
        memory.closeTask: extractLearning (LLM) → warehouse archive +
        clear worker's working memory
    → executive respond_to_principal("X is live") → principalSink →
      principal.receive → tap-only echo event → dashboard conversation
```

Every arrow above is an `EventBus.publish` to a single target mailbox (or, for the
principal reply, a tap-only delivery). The observer tap mirrors **all** of it to
the dashboard in real time.

### 14.3 Memory lifecycle of one task

`assembleContext` (BM25 warehouse hits prepended once) → agent accumulates turns
via `recordTurn` → task hits a terminal state → `closeTask` distills a `Learning`,
**archives** it to the warehouse, and **clears** the agent's working memory. Future
agents retrieve that learning by BM25 at `assembleContext`/`search_memory` time.

---

## 15. Configuration, commands & runtime topology

### 15.1 Processes

Two independent processes:

- **`@xevos/core`** — the agent runtime + observer server (one Node process,
  in-memory bus, lowdb files, optional Docker for engineering workers).
- **`@xevos/web`** — the Next.js dashboard, which connects to the core's
  observer over WebSocket/HTTP.

(Optional: a **Qdrant** container via `docker-compose.yml` — provisioned, not yet
used.)

### 15.2 Environment

| Var | Where | Purpose |
|---|---|---|
| `GOOGLE_GENERATIVE_AI_API_KEY` | core `.env` | Gemini access for `generateText` |
| `XEVOS_OBSERVER_PORT` | core `.env` | observer port (default `7077`) |
| `NEXT_PUBLIC_XEVOS_WS_URL` | web | WS endpoint (default `ws://127.0.0.1:7077/ws`) |
| `NEXT_PUBLIC_XEVOS_SNAPSHOT_URL` | web | snapshot endpoint (default `…/snapshot`) |

### 15.3 Commands (pnpm only)

| Command | Effect |
|---|---|
| `pnpm install` | install workspace deps |
| `pnpm dev` | run core + web in parallel (watch) |
| `pnpm core:dev` / `core:start` | run just the core runtime (tsx watch / compiled) |
| `pnpm web:dev` | run just the dashboard |
| `pnpm build` | build all packages |
| `pnpm typecheck` | type-check all packages (run before considering a change done) |
| `pnpm test` | Node test runner |
| `pnpm format` | Prettier |

> Per `AGENTS.md`: **pnpm only** (never npm/yarn), Node 24+, TS strict, ESM with
> `.js` extensions on relative imports where NodeNext resolution applies. Run
> `pnpm typecheck` before considering any change complete.

---

*This document reflects the source as read on 2026-06-25. When the code changes —
especially the §13.1 tool-dispatch gap — update this file alongside it.*
