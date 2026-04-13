# Agent Project Guidance

## Agent Behavior

- Use package manager: `bun`, `bunx` for script execution. Do not use `npm`, `npx`, or `yarn` for running scripts or managing dependencies.
- Do not run `oxlint` or `tsgo` directly; they are part of the `lint` script. Use `bun run lint` for both linting and typechecking.
- Do not disable existing lint rules. If a rule is conflicted or annoying, should stop and ask for clarification instead of disabling it. If a rule needs to be disabled, it should be done globally in the base configuration file, not in package-scoped config files.

## Commits

- Use Conventional Commits for any commit you create.
- Format: `type(scope): short summary`.
- Prefer scopes that match the workspace or package being changed: `cli`, `server`, `dashboard`, `api`, `api-client`, `ui`, `react-hooks`, `bsdiff-wasm`, `repo`.
- Valid types include: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `build`, `ci`, `perf`, `revert`.
- Keep the subject imperative, lowercase, and without a trailing period.
- Use `!` for breaking changes and include a `BREAKING CHANGE:` footer in the commit body when needed.
- If a change spans multiple workspaces and no single scope is dominant, use `repo` or omit the scope.

## Functional Style

- Prefer expressions over statements, composition over nesting, data over classes.
- Model errors as values with Effect; model state with XState actors.

## API Architecture

- Functional core, imperative shell — pure logic in Effect, side effects at the edges.
- Use Effect `HttpApi` / `HttpApiGroup` / `HttpApiEndpoint` for web handlers.

## CLI Architecture

- The CLI lives in `apps/cli` and is a Bun-first TypeScript ESM app.
- `src/index.ts` is the composition root: define the root `@effect/cli` command tree there and provide runtime layers such as `BunContext`, `ConfigStoreLive`, and `AuthStoreLive`.
- `src/commands/**` is the command surface. Keep command files thin: parse options, orchestrate flows, map typed domain errors to exit codes, and delegate reusable logic.
- `src/services/**` contains boundary adapters such as auth/config persistence and the typed API client. Prefer `Context.Tag` + `Layer` for dependency injection.
- `src/lib/**` is the reusable functional core for build/update helpers, app config parsing, git/runtime resolution, uploads, hashing, temp dirs, and output formatting. Keep this layer composable and easy to unit test.
- For backend calls, use the shared `@better-update/api` contract through `HttpApiClient`; do not introduce ad hoc fetch wrappers when a typed endpoint already exists.
- Use `@effect/platform` and `@effect/platform-bun` for filesystem, HTTP, and process boundaries. Keep side effects at the edges and return typed Effect errors from shared logic.
- Follow the existing command grouping pattern for nested features such as `build`, `credentials`, `env`, and `update`: feature folder with an `index.ts` entry and dedicated subcommand modules.

## CLI Tech Stack

- Runtime: Bun
- Language/module system: TypeScript + ESM
- CLI framework: `@effect/cli`
- Effects/runtime: `effect`
- Platform adapters: `@effect/platform`, `@effect/platform-bun`
- Shared API contract: `@better-update/api`
- Workspace/build orchestration: Bun workspaces + Turborepo
- Tests: Vitest unit tests in `apps/cli/src/**/*.test.ts`

## Testing

- Single `vitest.config.ts` with 3 projects: `unit`, `integration`, `e2e`.
- Use vitest globals (`describe`, `test`, `expect`) — do not import from `vitest`.
- Use `@effect/vitest` (`it.effect`, `it.scoped`) for testing Effect programs. Provide services via `Effect.provideService`, not `vi.mock`.
- Unit tests colocated in `src/**/*.test.ts`. Integration/E2E in `tests/`.
- Integration tests run in Workers runtime via `@cloudflare/vitest-pool-workers` with real D1.
- E2E tests use `unstable_startWorker` from `wrangler` with D1 migrations applied via CLI.
- Unit test coverage enforced at 80% (istanbul). Coverage scope: `src/auth/`, `src/domain/`, `src/cloudflare/` — excludes imperative shell (`index.ts`, `api.ts`, `handlers/`, `groups/`, `auth/middleware.ts`).
- `bun run test` = unit + coverage. `bun run test:integrations` = integration. `bun run test:e2e` = e2e. `bun run test:all` = everything.

## Skill Triggers

Before writing or modifying code, trigger relevant skills for up-to-date patterns. Do not rely on training data. The cost of an unnecessary skill call is near zero — skipping a relevant one leads to suboptimal patterns.

| File types     | Trigger skills                           |
| -------------- | ---------------------------------------- |
| `.ts`, `.tsx`  | `typescript-advanced`, `effect-advanced` |
| `.tsx`, `.jsx` | `react-advanced`, `react-web-advanced`   |
