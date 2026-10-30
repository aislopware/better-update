# Agent Project Guidance

Turborepo + bun workspaces (`apps/*`, `packages/*`). Run tasks from root — `bun run <task>` fans out via turbo.

## Tooling

- Use `bun`/`bunx` only — no `npm`/`npx`/`yarn`.
- `bun run lint` = lint + typecheck (never run oxlint/tsc/tsgo directly). Format via `bun run format` (oxfmt, not prettier).
- Deploy per app: `bun run deploy` inside `apps/server` / `apps/web`. Server dev runs behind portless proxy (`bun run dev:proxy` from root).
- Cloudflare CLI = `cf` (`bunx cf …`), never `wrangler`. Wrangler stays only for `secret put --name <worker>`, `tail` and the e2e test harness.
- `skills/better-update/` ships as a Claude Code plugin via `.claude-plugin/marketplace.json`. Editing the skill ⇒ bump that entry's `version`; installs are pinned to it and never update otherwise. Validate with `claude plugin validate .claude-plugin/marketplace.json --strict`.

## Deployment config

- The repo is deployment-neutral: never commit an account id, zone id, hostname, resource id, or contact address. Values live in untracked `.env.deploy` / CI `BU_*` variables; add new keys to the `KEYS` registry in `packages/deploy-config/src/index.ts` + `.env.deploy.example`.
- Worker config = `apps/{server,web}/cloudflare.config.ts`, read live by `cf`, the Vite plugin and the vitest plugin. Nothing is generated: never add a config generator, a `wrangler.jsonc` or a `*.generated.ts` for deploy values.
- Read deployment values from `vars` (server), `lib/site-config` (web, defined by `site-defines.ts`), `SERVICE_DEFAULTS` (CLI, a Bun macro). Never hardcode them in app or CI code.
- `.cloudflare/` (build output, `cf workers types`, local state) is git-ignored; `bun run lint` regenerates the types first.
- Deploy config holds non-secrets only; secrets go through `wrangler secret put`. See `docs/self-hosting.md`.
- Neutrality covers fixtures, seed data and comments too: use `example.com` / `com.example.*` hosts, synthetic ids, fictional names. Never a real person, company, customer, bundle id, Apple team id or keystore alias — including in tests. Only `LICENSE.md`'s copyright and `apps/web/src/routes/{terms,privacy}.tsx` name the operator.
- `.gitlab-ci.yml` is the whole pipeline and must stay instance-free: runner tags, images and registries are `BU_CI_*` variables, never literals.

## Server architecture (`apps/server/src/`): functional core, imperative shell

- Each top-level dir = one layer. Respect boundaries — no cross-imports, no new top-level dirs, no "application service" class layer; stop + ask if you think you need one.
- Pure layers (`domain/`, `http/`, `lib/`, `protocol/`): no I/O, no `cloudflare/`/`repositories/` imports. Web Crypto only via the `CryptoService` port.
- `Effect.promise`/`Effect.tryPromise` only in `repositories/` + `cloudflare/*Live` — the I/O boundary.
- `repositories/` = `Context.Tag` port + Live adapter colocated; `application/` orchestrates repos; `handlers/` = HTTP shell — never touch `env.DB/KV/R2` directly, never throw (errors = Effect values mapped via `http/to-api-effect.ts`).

## Style & UI

- Expressions over statements, data over classes. Errors as values via Effect; Effect `HttpApi`/`HttpApiGroup`/`HttpApiEndpoint` for web handlers.
- UI primitives = `@cloudflare/kumo` only, imported from `@better-update/ui/components/<name>`. Never import `@cloudflare/kumo` in an app.
- Kumo pass-throughs in `packages/ui/src/components/` are GENERATED — regenerate with `bun run scripts/gen-kumo-passthrough.ts`, never hand-edit. Hand-written compositions live beside them and must be negated back into `packages/ui/oxlint.config.ts`.
- React Compiler auto-memoizes `apps/web` (`viteReact({ compiler: true })`). Do not add `useMemo` / `useCallback` / `memo` for render cost. Never suppress a `react/*` compiler rule: a suppression makes the compiler skip that component.
- Exception: the compiler only compiles a `use*` hook that itself calls a hook. A hook made only of plain closures is left alone — give it one `useMemo` (and say why) or inline it into its caller.
- Style with Kumo tokens (`text-kumo-*` / `bg-kumo-*`) only. The shadcn colour roles are gone; the sole app-level roles left are `terminal*` and `brand*`, which Kumo has no word for. Toasts via `components/toast` (`toast.success` / `toast.error`); menus = `dropdown`.

## Lint disables

- Fix root cause first. Inline `// eslint-disable-next-line <rule> -- <reason>` only for legit framework exceptions; `-- <reason>` mandatory.
- No rule overrides in per-package `oxlint.config.ts` (only `extends` base + `ignorePatterns`) — global changes go in `packages/oxlint-config/src/base.ts` only. Same disable needed many places → stop + ask.

## Testing

- Unit tests colocated `src/**/*.test.ts`; integration + e2e in `tests/` (Workers runtime + real D1). Use vitest globals — no imports from `vitest`.
- Use `@effect/vitest` (`it.effect`) for Effect programs; provide services via `Effect.provideService`, not `vi.mock`.
- `bun run test` = unit + coverage; `test:integrations` / `test:e2e` / `test:all` for the rest.
