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

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
