## Project

`xevos` — a TypeScript project managed with **pnpm**. ESM (`"type": "module"`),
compiled with `tsc`. Source in `src/`, output in `dist/`.

## Toolchain

- **Package manager: pnpm only.** Never use `npm` or `yarn`. Use `pnpm add`,
  `pnpm install`, `pnpm run <script>`.
- Node 24+, TypeScript with `strict` mode enabled.

## Commands

- `pnpm install` — install dependencies
- `pnpm dev` — run in watch mode (`tsx`)
- `pnpm build` — compile to `dist/`
- `pnpm typecheck` — type-check without emitting
- `pnpm start` — run the compiled output
- `pnpm test` — run the Node test runner

## Conventions

- Keep `strict` type-safety; avoid `any` — prefer precise types or `unknown`.
- Use ESM `import`/`export` syntax; include `.js` extensions in relative
  imports when targeting NodeNext resolution.
- Match the style of surrounding code.

## Workflow rules

- Run `pnpm typecheck` before considering a change complete.
- Don't commit or push unless explicitly asked.

## Persistence

State lives in a local **SQLite** database (the org's single source of truth),
accessed through **Drizzle ORM** over `better-sqlite3` (WAL mode). Semantic
memory recall uses the **sqlite-vec** extension for vector KNN. No external
database or service is required — it is one file under `packages/core/storage/`.

- The schema is defined in `packages/core/src/db/schema.ts`; the connection,
  migration apply, and vector-table setup live in `packages/core/src/db/client.ts`.
- After changing the schema, regenerate the migration with
  `pnpm --filter @xevos/core exec drizzle-kit generate` and commit it.
- Repositories under `packages/core/src/repositories/` wrap Drizzle behind their
  class interfaces; `better-sqlite3` is synchronous, so read methods stay sync.
