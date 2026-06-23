# Tool Architecture — design notes & handoff

> Working doc capturing the current state of the `xevos` tool layer, the
> problems found by reading the repo, and the architecture we're converging on.
> Written to survive a session/environment switch (local CLI → web). Pick this
> up by pointing a fresh session at this file.

---

## 1. What this system actually is

An **actor model**:

- Each `BaseAgent` (`src/core/agents/index.ts`) owns a `Mailbox`, blocks on
  `takeNext()`, and on each event runs `reason()` →
  `generateText({ toolChoice: "required", tools: this.tools.getTools(id) })`,
  then executes the resulting tool-calls via `this.tools.execute(...)`.
- Agents never call each other directly. They coordinate **entirely through
  `EventBus` events** (`src/core/event-bus/index.ts`).
- Persistence: lowdb JSON files. Single process. In-memory bus.

**Key consequence:** in this codebase a "tool" is the agent's way to emit a
coordination event. That lens separates what is real from what is decorative.

---

## 2. Concrete findings from reading the repo

These are facts about the current code, not opinions.

### 2.1 `ToolRegistry` does not exist — the build is broken
- `agents/index.ts:4` imports `{ ToolRegistry, ToolResult } from "./services"`,
  but that file was **deleted** (`git status`: `D src/core/agents/services.ts`).
- `services/agent.ts:9` imports `{ ToolRegistry } from "../agents"`.
- `services/tools.ts` only exports the `ROLE_TOOLS` / `DEPARTMENT_TOOLS` **string
  maps** and `getAgentTools()`. There is **no class** with `.getTools(id)` or
  `.execute(config, part)` — the two methods `BaseAgent` depends on.
- `services/index.ts` exports `agent, memory, prompt` but **not `tools`**.

➡️ The missing `ToolRegistry` is the keystone. The broken build *and* the
redesign both route through it.

### 2.2 Role tools are real and well-formed — they map 1:1 onto events

| role tool | event emitted |
|---|---|
| `create_task` | `task_create_request` |
| `assign_task` | `task_delegation_request` |
| `escalate_blocker` | `escalation_request` |
| `request_information` | `information_request` |
| `request_review` | `review_presentation_request` |
| `send_message` | `message` |
| `create_department_{worker,manager,head}` | `agent_creation_request` |

Coherent verbs with a clear execution path (emit event → target mailbox).
**Role tools are at the right level of abstraction.** Only smell:
`create_department_*` is three tools for one event — collapse to a single
`create_subordinate` (the `agent_creation_request` body already carries `role`).

### 2.3 Department tools are inert strings — not tools in this system
- No event type for `code_repository`, `crm`, `figma`, etc. No schema. No executor.
- The **only** consumer is `prompt.ts:65-71`, which renders `agent.tools` as a
  bullet list under "Available Tools" in the system prompt.
- So a "department tool" today = **a word printed into a prompt**. The model
  can't invoke it; nothing executes it.

➡️ This is the category error, proven at the code level: role tools are *verbs*
(wired), department tools are *nouns* (resources/integrations, unwired).

### 2.4 The static lists aren't even connected to the executor
`getAgentTools()` returns `string[]`, but `reason()` calls
`this.tools.getTools(id)` on the missing registry. Nothing bridges string IDs →
`ai`-SDK tool definitions (with Zod params) → event emission.

### 2.5 Mid-refactor duplication
Old tree (`src/core/agents/schema/*`, `src/core/event-bus/schema/*`) deleted;
new tree (`src/core/schema/*`, `src/core/services/*`) untracked.

### 2.6 Minor issues
- `getModel` (`utils.ts:13`): `manager` falls through to `worker` (no `return`) —
  works by accident.
- `Task.budget` defined but never enforced.
- `Task.referceTask` typo (should be `referenceTask`).
- `Mailbox` is single-consumer; `"Mailbox already has a pending consumer"` will
  throw under fan-out.
- No policy gate on `agent_creation_request` → unbounded spawn.

---

## 3. The central architectural distinction

> **Stateless capabilities vs. stateful environments.**

### Stateless request/response → MCP
Browser, `web_search`, LinkedIn (sales), Twitter (marketing), `crm`, `figma`,
`analytics`. One call in, one result out, no environment carried between calls.
**MCP is exactly built for this.** Register one MCP server per integration; its
tools surface as `ai`-SDK tools. These are the "resource/integration" layer —
nouns exposing a few verb-tools, stateless so the actor loop doesn't care.

### Stateful, multi-step work → sandbox
**Coding** is categorically different. Not a tool call — work against a
persistent, mutable environment over many steps:
- a **filesystem** that survives across calls,
- **bash / arbitrary command execution** (install, build, test, git),
- a **workspace bound to a specific repo+branch** (the "which repo" instance),
- **isolation** — never run LLM-issued commands on the host,
- unit of work is **iterate-until-green**, not one-shot.

You cannot model this as "the worker has a `code_repository` tool." What it needs
is an **execution sandbox** + a small verb-set into it:

```
provision sandbox (container, repo checked out, branch created)
  → drive it: read_file / write_file / edit / run_command / list_dir
  → iterate (reason → act → observe → repeat) until tests pass
  → produce a diff / open a PR
teardown sandbox
```

- The **sandbox is the resource binding** ("worker bound to sandbox-N,
  `xevos/api` on branch `feat/x`").
- The **tools are computer-use verbs** scoped to that sandbox.
- `bash` is not a department tool; it's a gated verb *into* a bound, isolated
  environment (no host mount, scoped network, repo-scoped token only).
- This is essentially what Claude Code itself is: sandbox + Read/Edit/Bash + loop.

---

## 4. Two agent archetypes

Coordinators run one reasoning turn per event then `recordTurn`. A coding worker
needs a long inner loop before emitting a single org event. So:

| | **Coordinator** (exec/head/manager) | **Operator** (engineering worker) |
|---|---|---|
| driven by | incoming events | a claimed task |
| tools | event emitters (verbs → bus) | environment verbs (FS/bash → sandbox) + MCP capabilities |
| loop | one turn per event | multi-step until done |
| state | mailbox + memory | a live sandbox |

`AgentKind = "operator" | "reviewer"` already exists in `agent.schema.ts:17` —
that's the seam for the coordinator/operator split (or derive it from role).

**The sandbox stays internal to the worker's task execution.** The org still
coordinates via events — when iteration finishes, the worker emits
`request_review` / `task_transition_request` like everyone else. The event model
is undisturbed; a sandboxed loop is nested inside the worker's task handling.

---

## 5. The orthogonal-axes model (the redesign)

Today: two axes — `role` (authority) × `department` (org unit). Tools are forced
onto `department`, which is too coarse (a backend eng, an SRE, and an eng manager
share a department but not tools).

Add a **third axis: capability / profile** (the actual job function).

An agent's effective tools become a **computed intersection**, not a union of two
lists:

```
agent.tools =
    authority(role)            // event-emitting verbs, permission-gated
  ∩ capabilities(profile)      // job-function tools (backend-engineer, sdr, ...)
  ∩ bindings(resources)        // which instances: which repo, which CRM, which sandbox
  ∩ policy(guardrails)         // read/write/approval-gated, rate, budget, audit
```

- **Authority layer:** role → permissions over org-mutation verbs (not which
  verbs exist). Collapse `create_department_*` into `create_subordinate`; gate
  with `can(agent, action, target)`.
- **Capability layer (profiles):** named bundles, e.g. `backend-engineer`,
  `sdr`, `support-tier-1`. A capability resolves to **either** an MCP toolset
  **or** a sandbox-backed sub-agent — both are just things a profile grants.
- **Integration layer:** each external system is one MCP server exposing
  fine-grained, individually-permissioned tools. `code_repository` is not a
  tool; it's a connector, and capability `vcs.open_pr` maps to a specific tool.
- **Binding/policy layer:** scope each grant to instances + guardrails
  (read/write/approval, rate, budget, audit). This is the line between a demo and
  something pointed at production systems.

➡️ **Department degrades to a resource-binding scope**, not a tool list.

### Answers to the original 7 questions (summary)
1. Role tools — right level (event emitters). Keep; collapse the `create_*` trio.
2. Department tools — not tools; they're resources/integrations (proven in §2.3).
3. Attach via **profiles**, not per-department. Department = binding scope.
4. Scaling blockers (near-term, local): per-agent `getModel`, single-consumer
   `Mailbox`, lowdb whole-file writes, no spawn policy. Later: context-window
   tool bloat → lazy/JIT tool loading; resource *instances*; permission/audit.
5. Universal = event-emitting verbs (already `BASE_TOOLS`). Specific = bindings.
6/7. Production model = `ToolRegistry` as the seam that resolves a granted
   capability into an event-emitter, an MCP toolset, or a sandbox session, with
   `can()` in front and side-effects gated/audited.

---

## 6. The unifying seam: `ToolRegistry`

`ToolRegistry` resolves an agent's granted capability IDs into `ai`-SDK tools,
where each tool's `execute`:
- **verb (coordination)** → publishes the corresponding event to the bus;
- **stateless capability** → calls an MCP tool;
- **stateful work (coding)** → opens / drives a sandbox session.

With a `can(agent, action, target)` policy check in front of every call.

---

## 7. Open decisions (blocking the next step)

1. **Engineering worker shape:**
   - **Option A** — worker *is* the coding agent: directly drives FS/bash in a
     sandbox (most control, reimplements a coding harness).
   - **Option B** — worker *delegates*: one capability `run_coding_task(spec,
     repo, branch)` spins up a real coding agent/harness in a sandbox and returns
     a diff/PR; worker only writes spec + reviews. (Recommended — keeps
     coordinators thin, isolates the dangerous stateful thing.)

2. **Sandbox substrate:** Docker container-per-task (a `docker-compose.yml`
   already exists untracked) vs. a managed Sandbox SDK (e.g. Cloudflare Sandbox
   SDK) vs. git-worktree (weak isolation, same-host).

3. **First implementation scope:** minimal `ToolRegistry` to unbreak the build
   and wire role-tools→events (department tools stubbed) — leaning this way —
   vs. building the full profile/binding/policy redesign in one step.

---

## 8. Recommended next step

Build the minimal `ToolRegistry` that:
- resolves each role tool to an `ai`-SDK tool whose `execute` publishes the
  matching event (table in §2.2),
- collapses `create_department_*` → `create_subordinate`,
- stubs department/resource tools behind a single resolution path so they're
  explicit (no-op or "not yet bound") rather than inert prompt text,
- leaves a typed seam for capabilities to later resolve to MCP toolsets or
  sandbox sessions.

This unbreaks the build, makes the actor loop run end-to-end, and lands the
architecture's spine without committing to the full redesign yet.
