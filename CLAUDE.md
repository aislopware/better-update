# Agent Project Guidance

## Tooling

- Use `bun`/`bunx` for scripts + deps. No `npm`/`npx`/`yarn`.
- Use `bun run lint` for lint + typecheck. No `oxlint` or `tsgo`/`tsc` direct.

## Architecture: functional core, imperative shell (lightweight hexagonal)

Each dir under `apps/server/src/` = one layer. Respect boundary — no cross, no flatten.

| Layer            | Directory                                             | Role                                                                                  | May import                                                                       | Forbidden                                                                                                  |
| ---------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Pure core        | `domain/`                                             | Business rules, validation, transforms — sync fns or pure `Effect.gen`                | `effect`, other `domain/` files, types from `models.ts`                          | `cloudflare/`, `repositories/`, `application/`, `handlers/`, `@effect/platform`, any I/O primitive         |
| Pure mappers     | `http/`                                               | `domain model → API schema` sync mappers (`to-api.ts`, `to-api-effect.ts`)            | `effect`, `models.ts`, `@better-update/api`                                      | any I/O, any repository, any cloudflare adapter                                                            |
| Pure helpers     | `lib/`, `protocol/`                                   | Framework-agnostic utilities (base64, hex, type guards, Expo protocol encode/decode)  | `effect`, `@better-update/*`, other files in same dir                            | `cloudflare/`, `repositories/`, `handlers/`, `application/`, `domain/` — stay leaf-level                   |
| Ports + adapters | `repositories/`                                       | `Context.Tag` port interface + D1/KV/R2 `Live` adapter colocated in the same file     | `effect`, `cloudflare/context`, `domain/` types, `models.ts`                     | `handlers/`, `application/`, `http/`                                                                       |
| Use cases        | `application/`                                        | Multi-repo orchestration via `Effect.gen` + `yield* Repo`                             | `effect`, `repositories/`, `domain/`, types from `durable-objects/publish-types` | `cloudflare/`, `handlers/`, `http/`                                                                        |
| Imperative shell | `handlers/`                                           | `HttpApiBuilder.group` HTTP endpoints, yield repos + cloudflare services + domain fns | all layers above + `cloudflare/`, `auth/`, `audit/`, `errors/`                   | direct `env.DB` / `env.KV` / `env.R2` calls — must go through a repository or a `cloudflare/*Live` adapter |
| Imperative shell | `middleware/`                                         | `HttpApp.Default` wrappers (error format, request logging) composed at the app layer  | `effect`, `@effect/platform`, `@better-update/*`                                 | repositories, handlers, domain business logic                                                              |
| Imperative shell | `cloudflare/*Live`, `auth/middleware.ts`              | Side-effect adapters wrapping Cloudflare bindings + Web Crypto                        | anything                                                                         | —                                                                                                          |
| Wiring           | `app-layer.ts`, `infrastructure-layer.ts`, `index.ts` | Layer composition, DI, HTTP entrypoint                                                | anything                                                                         | —                                                                                                          |

- `Effect.promise` / `Effect.tryPromise` allowed only in `repositories/` + `cloudflare/*Live` — I/O boundary. Elsewhere, compose Effect services, no wrap raw async.
- `domain/` + `http/` + `lib/` + `protocol/` stay pure. Web Crypto calls go through `CryptoService` (port at `domain/crypto-service.ts`, adapter at `cloudflare/crypto-service.ts`).
- Handlers no throw. Errors = Effect values mapped via `http/to-api-effect.ts`.
- No new top-level dir under `apps/server/src/`. No "application service" class layer. Stop + ask if think need one.

## Functional style

- Expressions over statements, composition over nesting, data over classes.
- Errors as values via Effect. State via XState actors.
- Use Effect `HttpApi` / `HttpApiGroup` / `HttpApiEndpoint` for web handlers.

## Lint disable policy

- Fix root cause first. Refactor to satisfy rule before any disable.
- No rule overrides in package-scoped `.oxlintrc.json`. Only `extend` base + `ignorePatterns`. Global rule change go in `packages/oxlint-config/base.json` only.
- Same disable needed ~10+ places, or systemic framework pattern → stop + ask. Belong in `base.json` `overrides`, not scattered inline.
- Inline `// eslint-disable-next-line <rule> -- <reason>` = last resort, only legit framework exception. ` -- <reason>` mandatory. No reason, no disable.
- Test files (`**/*.test.*`) already have functional rules off via `overrides` — no inline disable in tests.
- JSX attributes: put disable comment inside element directly above attribute (oxlint no match `{/* */}` across JSX boundaries).

## Testing

- Single `vitest.config.ts`, 3 projects: `unit`, `integration`, `e2e`.
- Use vitest globals (`describe`, `test`, `expect`) — no import from `vitest`.
- Use `@effect/vitest` (`it.effect`, `it.scoped`) for Effect programs. Provide services via `Effect.provideService`, not `vi.mock`.
- Unit tests colocated `src/**/*.test.ts`. Integration/E2E in `tests/`.
- Integration tests run in Workers runtime via `@cloudflare/vitest-pool-workers` + real D1.
- E2E uses `unstable_startWorker` from `wrangler`, D1 migrations applied via CLI.
- Unit coverage scope (istanbul, 80% threshold): only `src/auth/`, `src/domain/`, `src/cloudflare/`. `cloudflare/*Live` adapters + `auth/middleware.ts` excluded — imperative shell, covered by integration/e2e.
- `handlers/`, `repositories/`, `application/`, `http/` out of unit coverage — cover via integration/e2e.
- `bun run test` = unit + coverage. `bun run test:integrations` = integration. `bun run test:e2e` = e2e. `bun run test:all` = all.
