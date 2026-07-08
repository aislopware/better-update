# Agent Project Guidance

Turborepo + bun workspaces (`apps/*`, `packages/*`). Run tasks from root — `bun run <task>` fans out via turbo.

## Tooling

- Use `bun`/`bunx` only — no `npm`/`npx`/`yarn`.
- `bun run lint` = lint + typecheck (never run oxlint/tsc/tsgo directly). Format via `bun run format` (oxfmt, not prettier).
- Deploy per app: `bun run deploy` inside `apps/server` / `apps/web`. Server dev runs behind portless proxy (`bun run dev:proxy` from root).

## Server architecture (`apps/server/src/`): functional core, imperative shell

- Each top-level dir = one layer. Respect boundaries — no cross-imports, no new top-level dirs, no "application service" class layer; stop + ask if you think you need one.
- Pure layers (`domain/`, `http/`, `lib/`, `protocol/`): no I/O, no `cloudflare/`/`repositories/` imports. Web Crypto only via the `CryptoService` port.
- `Effect.promise`/`Effect.tryPromise` only in `repositories/` + `cloudflare/*Live` — the I/O boundary.
- `repositories/` = `Context.Tag` port + Live adapter colocated; `application/` orchestrates repos; `handlers/` = HTTP shell — never touch `env.DB/KV/R2` directly, never throw (errors = Effect values mapped via `http/to-api-effect.ts`).

## Style & UI

- Expressions over statements, data over classes. Errors as values via Effect; Effect `HttpApi`/`HttpApiGroup`/`HttpApiEndpoint` for web handlers.
- UI primitives = shadcn base-ui (`packages/ui`, style `base-nova`) only — Base UI primitives, no Radix. Add/update via `bunx --bun shadcn@latest add <name>` in `packages/ui`; toasts via sonner (`components/ui/sonner`), menus = `dropdown-menu`.

## Lint disables

- Fix root cause first. Inline `// eslint-disable-next-line <rule> -- <reason>` only for legit framework exceptions; `-- <reason>` mandatory.
- No rule overrides in per-package `oxlint.config.ts` (only `extends` base + `ignorePatterns`) — global changes go in `packages/oxlint-config/src/base.ts` only. Same disable needed many places → stop + ask.

## Testing

- Unit tests colocated `src/**/*.test.ts`; integration + e2e in `tests/` (Workers runtime + real D1). Use vitest globals — no imports from `vitest`.
- Use `@effect/vitest` (`it.effect`) for Effect programs; provide services via `Effect.provideService`, not `vi.mock`.
- `bun run test` = unit + coverage; `test:integrations` / `test:e2e` / `test:all` for the rest.
