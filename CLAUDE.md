# Agent Project Guidance

## Tooling

- Use `bun`/`bunx` for scripts and deps. Do not use `npm`/`npx`/`yarn`.
- Use `bun run lint` for lint + typecheck. Do not run `oxlint` or `tsgo`/`tsc` directly.

## Architecture: functional core, imperative shell (lightweight hexagonal)

Each directory under `apps/server/src/` maps to a layer. Respect the boundary — do not cross, do not flatten.

| Layer            | Directory                                             | Role                                                                                  | May import                                                                       | Forbidden                                                                                                  |
| ---------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Pure core        | `domain/`                                             | Business rules, validation, transforms — sync fns or pure `Effect.gen`                | `effect`, other `domain/` files, types from `models.ts`                          | `cloudflare/`, `repositories/`, `application/`, `handlers/`, `@effect/platform`, any I/O primitive         |
| Pure mappers     | `http/`                                               | `domain model → API schema` sync mappers (`to-api.ts`, `to-api-effect.ts`)            | `effect`, `models.ts`, `@better-update/api`                                      | any I/O, any repository, any cloudflare adapter                                                            |
| Ports + adapters | `repositories/`                                       | `Context.Tag` port interface + D1/KV/R2 `Live` adapter colocated in the same file     | `effect`, `cloudflare/context`, `domain/` types, `models.ts`                     | `handlers/`, `application/`, `http/`                                                                       |
| Use cases        | `application/`                                        | Multi-repo orchestration via `Effect.gen` + `yield* Repo`                             | `effect`, `repositories/`, `domain/`, types from `durable-objects/publish-types` | `cloudflare/`, `handlers/`, `http/`                                                                        |
| Imperative shell | `handlers/`                                           | `HttpApiBuilder.group` HTTP endpoints, yield repos + cloudflare services + domain fns | all layers above + `cloudflare/`, `auth/`, `audit/`, `errors/`                   | direct `env.DB` / `env.KV` / `env.R2` calls — must go through a repository or a `cloudflare/*Live` adapter |
| Imperative shell | `cloudflare/*Live`, `auth/middleware.ts`              | Side-effect adapters wrapping Cloudflare bindings                                     | anything                                                                         | —                                                                                                          |
| Wiring           | `app-layer.ts`, `infrastructure-layer.ts`, `index.ts` | Layer composition, DI, HTTP entrypoint                                                | anything                                                                         | —                                                                                                          |

- `Effect.promise` is only allowed inside `repositories/` and `cloudflare/*Live` — these are the I/O boundary. Elsewhere, compose existing Effect services instead of wrapping raw async.
- `domain/` and `http/` must stay pure — if logic needs I/O, it belongs in a repository or adapter, not here.
- Handlers do not throw. Errors are Effect values mapped through `http/to-api-effect.ts`.
- Do not create a new top-level directory under `apps/server/src/`, and do not introduce an "application service" class layer. Stop and ask if you believe one is needed.

## Functional style

- Prefer expressions over statements, composition over nesting, data over classes.
- Model errors as values with Effect; model state with XState actors.
- Use Effect `HttpApi` / `HttpApiGroup` / `HttpApiEndpoint` for web handlers.

## Lint disable policy

- Fix the root cause first. Refactor to satisfy the rule before reaching for any disable.
- Do not add rule overrides to package-scoped `.oxlintrc.json` files. They may only `extend` base and add `ignorePatterns`. Global rule changes go in `packages/oxlint-config/base.json` only.
- If the same disable would be needed in ~10 or more places, or if it reflects a systemic framework pattern, stop and ask — it belongs in `base.json` `overrides`, not scattered inlines.
- Inline `// eslint-disable-next-line <rule> -- <reason>` is the last resort and only for legitimate framework exceptions. The ` -- <reason>` comment is mandatory. No reason, no disable.
- Test files (`**/*.test.*`) already have functional rules off globally via `overrides` — do not add inline disables in tests.
- For JSX attributes, place the disable comment inside the element directly above the attribute (oxlint does not match `{/* */}` across JSX boundaries).

## Testing

- Single `vitest.config.ts` with 3 projects: `unit`, `integration`, `e2e`.
- Use vitest globals (`describe`, `test`, `expect`) — do not import from `vitest`.
- Use `@effect/vitest` (`it.effect`, `it.scoped`) for Effect programs. Provide services via `Effect.provideService`, not `vi.mock`.
- Unit tests colocated in `src/**/*.test.ts`. Integration/E2E in `tests/`.
- Integration tests run in Workers runtime via `@cloudflare/vitest-pool-workers` with real D1.
- E2E tests use `unstable_startWorker` from `wrangler` with D1 migrations applied via CLI.
- Unit coverage scope (istanbul, 80% threshold): only `src/auth/`, `src/domain/`, `src/cloudflare/`. Specific `cloudflare/*Live` adapters and `auth/middleware.ts` are excluded — they are imperative shell, covered indirectly by integration/e2e.
- `handlers/`, `repositories/`, `application/`, `http/` are out of unit coverage scope — cover them with integration/e2e instead.
- `bun run test` = unit + coverage. `bun run test:integrations` = integration. `bun run test:e2e` = e2e. `bun run test:all` = everything.

## Skill triggers

Before writing or modifying code, trigger relevant skills for up-to-date patterns. Do not rely on training data. The cost of an unnecessary skill call is near zero — skipping a relevant one leads to suboptimal patterns.

| File types     | Trigger skills                           |
| -------------- | ---------------------------------------- |
| `.ts`, `.tsx`  | `typescript-advanced`, `effect-advanced` |
| `.tsx`, `.jsx` | `react-advanced`, `react-web-advanced`   |
