# Agent Project Guidance

Root instruction map for coding agents. Keep it short; add workspace-specific rules in nested `AGENTS.md` files only when needed. The nearest `AGENTS.md` applies.

## Highest-Priority Rules

- Use `bun` and `bunx`; never `npm`, `npx`, or `yarn`.
- Use `bun run lint` for linting/typechecking; do not run `oxlint`, `tsgo`, or `tsc` directly.
- Fix lint root causes. Do not disable rules to make a change pass; if a rule seems wrong/systemic, stop and ask. Shared rule changes belong in `packages/oxlint-config/base.json`, not package-local overrides.
- Inline lint disables are last resort, must include `-- <reason>`, and should not be used in tests.
- Prefer the smallest relevant check while iterating, then run final relevant lint/test commands before finishing.
- If a task is scoped to one workspace, inspect that workspace first instead of scanning the monorepo.

## Repo Map

- `apps/server`: Cloudflare Worker server.
- `apps/web`: web app (accounts + dashboard merged, TanStack Start SSR).
- `apps/cli`: Bun-first TypeScript ESM CLI.
- `packages/api`: shared HTTP contracts and transport schemas.
- `packages/api-client`: typed client for `packages/api`.
- `packages/ui`, `packages/react-hooks`: shared frontend building blocks.
- `packages/bsdiff-wasm`: WASM patching package.
- `docs/specs/eas-update-protocol.md`: protocol reference.

## Architecture Invariants

- Use functional core + imperative shell with lightweight hexagonal boundaries.
- In `apps/server/src`, keep layer boundaries intact: `domain/`, `http/`, `lib/`, and `protocol/` are pure; `repositories/` are ports/adapters; `application/` orchestrates use-cases; handlers, middleware, Cloudflare adapters, auth middleware, and wiring files are the shell.
- Keep `domain/**` pure. Do not depend on `Request`, `Response`, Cloudflare bindings, Bun globals, D1 SQL, R2, KV, `process`, or `@better-update/api` transport DTOs.
- Keep `http/`, `lib/`, and `protocol/` pure/leaf-level: no I/O, repositories, handlers, application, or Cloudflare adapter imports.
- Use `application/**` for flows that coordinate ports; application code may depend on ports and domain modules, not concrete adapters.
- Repositories are adapters. Keep persistence/retrieval there; put orchestration, authz, audit side effects, cache invalidation, and multi-step workflows in use-cases.
- Model boundaries as `Context.Tag` services and wire them with `Layer` at the composition root. Keep service methods `R = never`.
- Avoid scattered `Effect.provide(...)` inside commands, handlers, repositories, or shared library code.
- Use raw async (`Effect.promise` / `Effect.tryPromise`) only in `repositories/` and `cloudflare/*Live`; elsewhere compose services.
- Keep transport contracts at the edge. `packages/api` defines DTOs; handlers map between transport models and application/domain models.
- Web Crypto goes through `CryptoService`; handlers must not throw or call `env.DB`/KV/R2 directly; map errors via `http/to-api-effect.ts`.
- Prefer request-scoped server context over module-global mutable state.
- Use Effect `HttpApi`, `HttpApiGroup`, and `HttpApiEndpoint` for HTTP handlers.
- Do not add new top-level dirs under `apps/server/src` or introduce an “application service” class layer without asking.

## UI Primitives

- Use `@base-ui/react` only. Do not use `@radix-ui/*`.
- shadcn must stay on the `base` preset: preserve `base: "base"` in `components.json`; pass `--base base` if needed.

## CLI Notes

- `apps/cli/src/index.ts` is the composition root for the command tree and runtime layers.
- `apps/cli/src/commands/**` is the command surface. Keep command modules thin: parse options, call reusable flows, and map typed errors to exit codes/output.
- `apps/cli/src/services/**` contains boundary adapters such as auth/config persistence and the typed API client.
- `apps/cli/src/lib/**` is the reusable functional core for CLI-specific logic.
- Use `HttpApiClient` with `@better-update/api` for backend calls instead of ad hoc fetch wrappers.
- Use `@effect/platform` and `@effect/platform-bun` for filesystem, HTTP, and process boundaries.

## Style

- Prefer expressions over statements, composition over nesting, and data over classes.
- Model errors as values with Effect. Model complex state with XState actors.

## Testing

- `vitest.config.ts` defines `unit`, `integration`, and `e2e` projects.
- Use Vitest globals. Do not import `describe`, `test`, or `expect` from `vitest`.
- For Effect programs, prefer `@effect/vitest` (`it.effect`, `it.scoped`) and provide services with `Effect.provideService` rather than `vi.mock`.
- Unit tests live in `src/**/*.test.ts`. Integration and E2E tests live in `tests/`.
- Integration tests run in the Workers runtime with real D1. E2E tests use `unstable_startWorker` from `wrangler`.
- Unit coverage is enforced at 80% for `src/auth/`, `src/domain/`, and `src/cloudflare/`; shell/adapters and use-case/handler/repository/http flows are covered by integration/e2e.
- Commands: `bun run test`, `bun run test:integrations`, `bun run test:e2e`, `bun run test:all`.

## Commits

- Use Conventional Commits: `type: short summary` or `type(scope): short summary`; scope is optional.
- Prefer scopes that match the dominant workspace/package: `cli`, `server`, `web`, `api`, `api-client`, `ui`, `react-hooks`.
- Do not use `repo` as a scope. If a change is truly repository-wide, omit the scope: `feat: short summary`.
- If changes span many apps/packages, split them into multiple atomic commits; each commit should cover only a small, coherent scope.
- Valid types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `build`, `ci`, `perf`, `revert`.
- Keep commits atomic: one logical change per commit; split mixed `feat`/`fix`/`refactor` changes when possible.
- Keep the subject imperative, lowercase, and without a trailing period.
- Add a body when useful to summarize what changed/why in more detail than the subject; bullets are fine.
- Use `!` for breaking changes and include a `BREAKING CHANGE:` footer with migration notes when relevant.
