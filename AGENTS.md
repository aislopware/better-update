# Agent Project Guidance

This file is the root instruction map for coding agents. Keep it short. Add deeper, workspace-specific guidance in nested `AGENTS.md` files only when a subproject needs rules that do not belong at the repo root. The nearest `AGENTS.md` applies to the files being edited.

## Highest-Priority Rules

- Use `bun` and `bunx`. Do not use `npm`, `npx`, or `yarn`.
- Use `bun run lint` for linting and typechecking. Do not run `oxlint`, `tsgo`, or `tsc` directly.
- Do not disable lint rules to make a change pass. If a rule is genuinely wrong, stop and ask. If it must change, update the shared base config rather than a package-local override.
- Prefer the smallest relevant check while iterating, then run the final relevant lint/test commands before finishing.
- If the task is scoped to one workspace, inspect that workspace first instead of scanning the entire monorepo.

## Repo Map

- `apps/server`: Cloudflare Worker server.
- `apps/web`: web app (accounts + dashboard merged, TanStack Start SSR).
- `apps/cli`: Bun-first TypeScript ESM CLI.
- `packages/api`: shared HTTP contracts and transport schemas.
- `packages/api-client`: typed client for `packages/api`.
- `packages/ui`, `packages/react-hooks`: shared frontend building blocks.
- `packages/bsdiff-wasm`: WASM patching package.
- `docs/specs/eas-update-protocol.md`: protocol reference.

## Style

- Prefer expressions over statements, composition over nesting, and data over classes.
- Model errors as values with Effect. Model complex state with XState actors.

## Architecture Invariants

- Use functional core + imperative shell with lightweight hexagonal boundaries.
- Keep `domain/**` pure. Do not depend on `Request`, `Response`, Cloudflare bindings, Bun globals, D1 SQL, R2, KV, `process`, or `@better-update/api` transport DTOs in domain code.
- Use `application/**` for flows that coordinate multiple ports. Application code may depend on ports and domain modules, but not concrete adapters.
- Model boundaries as `Context.Tag` services and wire them with `Layer` at the composition root.
- Keep service methods `R = never`; capture dependencies in layer implementations instead of leaking them through method signatures.
- Avoid scattered `Effect.provide(...)` inside commands, handlers, repositories, or shared library code.
- Repositories are adapters. Keep persistence/retrieval in repositories; put orchestration, authz, audit side effects, cache invalidation, and multi-step workflows in use-cases.
- Keep transport contracts at the edge. `packages/api` defines DTOs; handlers map between transport models and application/domain models.
- Prefer request-scoped server context over module-global mutable state.
- Use Effect `HttpApi`, `HttpApiGroup`, and `HttpApiEndpoint` for HTTP handlers.

## CLI Notes

- `apps/cli/src/index.ts` is the composition root for the command tree and runtime layers.
- `apps/cli/src/commands/**` is the command surface. Keep command modules thin: parse options, call reusable flows, and map typed errors to exit codes/output.
- `apps/cli/src/services/**` contains boundary adapters such as auth/config persistence and the typed API client.
- `apps/cli/src/lib/**` is the reusable functional core for CLI-specific logic.
- Use `HttpApiClient` with `@better-update/api` for backend calls instead of ad hoc fetch wrappers.
- Use `@effect/platform` and `@effect/platform-bun` for filesystem, HTTP, and process boundaries.

## Testing

- `vitest.config.ts` defines `unit`, `integration`, and `e2e` projects.
- Use Vitest globals. Do not import `describe`, `test`, or `expect` from `vitest`.
- For Effect programs, prefer `@effect/vitest` (`it.effect`, `it.scoped`) and provide services with `Effect.provideService` rather than `vi.mock`.
- Unit tests live in `src/**/*.test.ts`. Integration and E2E tests live in `tests/`.
- Integration tests run in the Workers runtime with real D1. E2E tests use `unstable_startWorker` from `wrangler`.
- Coverage is enforced at 80% for `src/auth/`, `src/domain/`, and `src/cloudflare/`; imperative shell files are excluded.
- Commands: `bun run test`, `bun run test:integrations`, `bun run test:e2e`, `bun run test:all`.

## Commits

- Use Conventional Commits: `type(scope): short summary`.
- Prefer scopes that match the dominant workspace/package: `cli`, `server`, `web`, `api`, `api-client`, `ui`, `react-hooks`, `bsdiff-wasm`, `repo`.
- Valid types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `build`, `ci`, `perf`, `revert`.
- Keep the subject imperative, lowercase, and without a trailing period.
- Use `!` for breaking changes and include a `BREAKING CHANGE:` footer when needed.
- If no single workspace dominates, use `repo` or omit the scope.

## Skill Triggers

- `.ts`, `.tsx`: `typescript-advanced`, `effect-advanced`
- `.tsx`, `.jsx`: `react-advanced`, `react-web-advanced`
