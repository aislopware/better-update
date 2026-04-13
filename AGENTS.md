# Agent Project Guidance

## Agent Behavior

- Use package manager: `bun`, `bunx` for script execution. Do not use `npm`, `npx`, or `yarn` for running scripts or managing dependencies.
- Do not run `oxlint` or `tsgo` directly; they are part of the `lint` script. Use `bun run lint` for both linting and typechecking.
- Do not disable existing lint rules. If a rule is conflicted or annoying, should stop and ask for clarification instead of disabling it. If a rule needs to be disabled, it should be done globally in the base configuration file, not in package-scoped config files.

## Functional Style

- Prefer expressions over statements, composition over nesting, data over classes.
- Model errors as values with Effect; model state with XState actors.

## API Architecture

- Functional core, imperative shell — pure logic in Effect, side effects at the edges.
- Use Effect `HttpApi` / `HttpApiGroup` / `HttpApiEndpoint` for web handlers.

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
