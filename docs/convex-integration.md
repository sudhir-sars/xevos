# Convex integration plan

How xevos moves from the in-memory EventBus + lowdb substrate to **self-hosted
Convex** as the durable, reactive source of truth.

## Why

- **Durability + crash recovery** — state and in-flight work survive restarts
  (the in-memory bus and lowdb did not).
- **Transactional writes** — Convex mutations remove the lowdb read-modify-write
  lost-update races.
- **Reactivity for free** — the dashboard subscribes to reactive queries instead
  of the hand-rolled WebSocket observer + snapshot endpoint.
- **Native vector search** — the memory warehouse uses a Convex `vectorIndex`,
  retiring BM25/Qdrant.
- **No cloud bill** — runs self-hosted via `docker-compose.yml`.

## Architecture decision (already agreed)

Direct execution stays the primary path; **events are a projection**, not the
transport. In Convex terms:

| Concern | Mechanism |
| --- | --- |
| Synchronous org ops (create/transition/spawn/query/memory) | **Mutations / queries** returning real results |
| Async agent→agent work (delegate, escalate, review) | rows in the **`inbox`** table |
| Observability / UI / audit | the **`events`** table + **reactive queries** (atomic: the event row is written in the same mutation as the effect) |

The runtime stays a **local process**; Convex is the durable, reactive store it
reads/writes. On restart it rehydrates from Convex and continues.

## Data model → see `convex/schema.ts`

| lowdb repository / concept | Convex table |
| --- | --- |
| `AgentRepository` (`agents.json`) | `agents` (+ `counters` for readable ids) |
| `TaskRepository` | `tasks` |
| `AgentMemoryRepository` | `agentMemories` |
| `MemoryWarehouseRepository` (BM25/Qdrant) | `memoryWarehouse` (+ `vectorIndex`) |
| `PromptRepository` | `prompts` |
| EventBus broadcast + `observer/ws-server.ts` | `events` (reactive query) |
| EventBus mailbox delivery | `inbox` (durable queue) |

Readable ids (e.g. `manager_research_1`, `task_1`) are kept as fields, since
agents reference each other by them in prompts and event bodies.

## Staged port (each stage verified locally via `npx convex dev`)

1. **Scaffold + schema** ← _you are here_. `convex/schema.ts`, `convex.json`,
   the `agents.ts` exemplar, scripts.
2. **Repository functions** — port each repo to a Convex module behind its
   existing interface: `agents.ts` (done, exemplar), then `tasks.ts`,
   `agentMemories.ts`, `memoryWarehouse.ts`, `prompts.ts`.
3. **Repository adapters** — keep the current `*.repository.ts` class APIs, but
   back them with a `ConvexHttpClient` calling the functions above, so
   `MemoryService`, `TaskService`, `AgentService`, etc. need no changes.
4. **Event log + inbox** — `events.ts` (append + reactive feed) and `inbox.ts`
   (enqueue/claim/consume). Rewire the bus tools and delegation onto `inbox`;
   emit the `events` row in the same mutation as each effect.
5. **Observer swap** — delete `observer/ws-server.ts` + the snapshot endpoint;
   point `apps/web` at Convex reactive queries (`convex/react`).
6. **Memory vectors** — embed learnings on archive; replace BM25 recall with a
   `vectorIndex` search action.
7. **Cleanup** — drop `lowdb`, `fast-bm25`, `ws`; update `AGENTS.md` (which still
   names Convex aspirationally).

## Local setup (must run on the machine hosting the backend)

```bash
docker compose up -d                                  # backend + dashboard
docker compose exec backend ./generate_admin_key.sh   # -> admin key
pnpm -w add convex                                     # client + CLI
# packages/core/.env.local  (gitignored):
#   CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210
#   CONVEX_SELF_HOSTED_ADMIN_KEY=<admin key>
pnpm convex:dev        # deploys schema, generates convex/_generated, watches
```

`npx convex ai-files install` drops Convex's canonical AI guidelines into the
repo — read those before writing further functions (project rule).

> Heads-up: `convex/_generated/` is gitignored and produced by the CLI, so until
> `convex dev` runs locally the function modules won't typecheck. That's
> expected for a fresh Convex project and resolves on first run.
