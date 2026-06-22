# xevos

> **OrgOS** — a runtime for building self-operating, AI-powered companies.

`xevos` is a TypeScript implementation of the **Autonomous Agent Organization (AAO)**
framework: a system for taking a single high-level directive ("grow revenue by
launching Product X this quarter") and pursuing it autonomously — decomposing it
into objectives, delegating work down a hierarchy of specialized agents, executing
with tools, verifying its own output, tracking progress against measurable goals,
and escalating to humans only when it should.

It is built on two hard assumptions:

1. **Agents are stateless, fallible language models, not employees.** They forget
   between calls, occasionally invent facts, have no intrinsic sense of cost, and
   cannot act without tools. Every subsystem exists to compensate for one of those.
2. **Autonomy is the dangerous part.** A company that can spend money, ship code,
   and talk to the outside world without a human in the loop is exactly as risky as
   it is useful. Governance is a first-class layer, not a footnote.

> **Status: early scaffolding.** The repository currently contains the project
> skeleton (event bus, shared types, entrypoint). The architecture below is the
> target this codebase is being built toward. See [Roadmap](#roadmap) for what
> exists today versus what is planned.

---

## Concept

The organization runs as a stack of layers on a shared substrate. Each layer is
built on the ones beneath it.

```
┌────────────────────────────────────────────────────────────────┐
│  GOVERNANCE LAYER   budgets · approval gates · guardrails ·    │
│                     audit log · kill switch                    │
├────────────────────────────────────────────────────────────────┤
│  ORGANIZATION LAYER CEO · Heads · Managers · ICs · Reviewers   │
│                     decision rights · OKR tree                 │
├────────────────────────────────────────────────────────────────┤
│  COORDINATION LAYER message bus · task board · channels ·      │
│                     escalation routing                         │
├────────────────────────────────────────────────────────────────┤
│  AGENT RUNTIME      the perceive→reason→act→observe loop,      │
│                     run per agent                              │
├────────────────────────────────────────────────────────────────┤
│  SUBSTRATE          memory stores · tool registry · identity   │
│                     & permissions · observability              │
└────────────────────────────────────────────────────────────────┘
```

### Core ideas

- **Specialization beats generalization.** Each agent gets a narrow charter, a
  focused system prompt, and a small toolset. A finance agent never sees the
  codebase; an engineering IC never reasons about brand strategy.
- **Hierarchy is context management.** Managers compress reality: they decompose
  goals into focused tasks on the way down and summarize results into status on
  the way up, so every agent operates on a relevant slice rather than the whole.
- **Separate the doer from the checker.** Verification is a distinct Reviewer role,
  so hallucinations and shortcuts are caught by an agent that didn't produce them.
- **Every handoff is structured and evidenced.** Acceptance criteria flow down;
  evidence of completion flows up. Free-text "here you go" handoffs are banned.
- **Tie autonomy to blast radius.** Reversible, cheap, internal actions run fully
  autonomously. Irreversible, expensive, or external actions require approval.
- **Budgets are not optional.** Every agent and task carries token, cost, and
  action ceilings; exhausting one triggers escalation, never silent continuation.
- **Escalation is the universal safety valve.** An agent that is uncertain,
  blocked, over budget, or facing a high-stakes action escalates rather than guesses.

---

## The agent loop

Every agent — from CEO to junior IC — is an instance of the same runtime,
parameterized by a different charter, prompt, and toolset. Each time it runs, it
executes one cycle:

1. **Perceive** — the runtime assembles the agent's context: its charter, the
   relevant slice of memory, its unread inbox, and the state of tasks it owns.
2. **Reason** — a single LLM call decides what to do: take a tool action, send a
   message, delegate a task, report status, or escalate.
3. **Act** — the runtime executes each action _after_ checking it against the
   agent's autonomy tier and budget. Over-tier or over-budget actions become
   escalations instead of being executed.
4. **Observe** — results are written back to memory and task records, becoming
   part of the agent's context next cycle.

---

## Roles

| Role                        | Owns                                              | Notes                                                                                                |
| --------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **CEO**                     | Vision, strategy, the top-level OKR tree          | Only agent that interfaces with the human board; only agent that changes the top objective.          |
| **Marketing Head**          | Brand, demand gen, content, campaigns             | Approves outbound content up to its tier.                                                            |
| **Finance Head**            | Budgeting, forecasting, spend approval            | Structural **spending gatekeeper** for the whole org; can trip the spending circuit breaker.         |
| **Engineering Head**        | Product/technical roadmap, architecture, delivery | Approves architecture and staging deploys; production deploys are above solo authority.              |
| **Managers**                | One project or team                               | The load-bearing role: decompose-and-delegate down, aggregate-and-report up.                         |
| **Individual Contributors** | The actual work, using tools                      | Take one task at a time, self-check against acceptance criteria, attach evidence, submit for review. |
| **Chief of Staff**          | Cross-cutting coordination                        | Runs the org-wide standup, routes cross-functional requests, maintains the dashboard.                |
| **Reviewer / Critic**       | Independent verification                          | Structurally separate from producers; approves with evidence or returns with change requests.        |
| **Human Liaison**           | The boundary to people                            | Every approval gate and high-stakes escalation flows through here.                                   |

---

## Governance & autonomy tiers

Every action is classified by consequence; authorization scales with it. An
agent's `autonomy_tier` is the highest class it may execute without approval.

| Tier | Action class                    | Examples                                       | Authorization                 |
| ---- | ------------------------------- | ---------------------------------------------- | ----------------------------- |
| 0    | Read-only / internal            | search memory, draft text, plan                | Fully autonomous              |
| 1    | Reversible internal             | create a task, write an internal doc           | Autonomous within budget      |
| 2    | Reversible external, low stakes | open a PR, run tests, prepare a draft          | Autonomous; logged + reviewed |
| 3    | Costly or semi-reversible       | spend to a threshold, deploy to staging        | Functional Head approval      |
| 4    | Irreversible / high stakes      | large spend, prod deploy, external/legal comms | **Human approval gate**       |

Backed by per-agent and per-task **budgets**, a **policy layer** in front of the
tool registry, an immutable **audit log**, and a global **kill switch** that can
freeze the whole org into a safe, resumable state.

---

## Core schemas

The data model is five schemas: **Agent**, **Message**, **Task**, **OKR**, and
**Decision**. A working instance of the framework is those schemas, a generic
agent runtime, the orchestration loop, the substrate services (bus, memory, tool
registry, permissions, audit), and one charter + system prompt per role.

```jsonc
// Task — every delegation carries acceptance criteria down; every completion carries evidence up.
{
  "task_id": "T-1043",
  "title": "Implement auth token refresh",
  "parent": "objective:O-20",
  "assigned_to": "eng-ic-004",
  "acceptance_criteria": [
    "tokens refresh transparently before expiry",
    "tests pass",
  ],
  "deliverable_spec": { "type": "pull_request", "location": "repo://app/auth" },
  "budget": { "usd": 5, "tokens": 100000 },
  "status": "in_progress",
  "review": { "reviewer": "qa-002", "verdict": null },
}
```

---

## Getting started

This project uses **pnpm** (Node 24+, TypeScript with `strict` mode, ESM).

```bash
pnpm install        # install dependencies
pnpm dev            # run in watch mode (tsx)
pnpm build          # compile to dist/
pnpm typecheck      # type-check without emitting
pnpm start          # run the compiled output
pnpm test           # run the Node test runner
```

> **pnpm only** — do not use `npm` or `yarn`.

### Project layout

```
src/
  index.ts            # entrypoint
  event-bus/          # the message bus — async fabric agents communicate over
  types/              # shared types (branded IDs, schemas)
dist/                 # compiled output (gitignored)
```

---

## Roadmap

The framework is being built bottom-up, substrate first.

- [x] Project scaffolding (TypeScript, ESM, pnpm, test runner)
- [ ] **Substrate** — message bus, tool registry, memory stores, permissions, audit log
- [ ] **Core schemas** — Agent, Message, Task, OKR, Decision
- [ ] **Agent runtime** — the perceive→reason→act→observe cycle
- [ ] **Orchestration loop** — event-driven + scheduled, with concurrency & checkpointing
- [ ] **Governance layer** — autonomy tiers, budgets, approval gates, kill switch
- [ ] **Role charters & system prompts** — CEO, Heads, Managers, ICs, Reviewers
- [ ] **Feedback loops** — task review, project re-planning, KPI tracking, post-mortems

### Maturity model

Autonomy is grown in three stages, not switched on day one:

1. **Crawl — human-supervised.** Agents propose; humans approve nearly everything.
2. **Walk — human-on-the-loop.** Agents act on reversible/low-stakes work; humans review by exception.
3. **Run — human-in-the-loop for high stakes only.** The org self-corrects; humans engage at Tier-4 gates and on strategy.

---

## License

MIT
