# Environment variables

The `env` command manages **server-side, project** environment variables. They are E2E-encrypted,
versioned, scoped to an environment, and injected into `expo export` at publish time — so values like
API keys live on the server, not in the repo. This is **not** local `.env` management; the values are
stored on better-update and `update publish` fetches them.

Why server-side: secrets stay out of git; different environments (`production`, `staging`,
`development`) get different values without branch-specific configs; new developers don't need a
`.env` handed to them out-of-band.

Values can be created/edited from the **web** too (`updates-vault.<host>`), not just the CLI — once
the user has set up env-vault access (account key + passkey + an admin grant; see
`references/credentials.md`) **and** holds a role that can write env vars. The main dashboard origin
stays read-only metadata; value editing happens on the vault origin.

## Visibility: `plaintext` or `sensitive` (there is no "secret")

Every var has one of **two** visibilities. There is no `secret` tier — passing `--visibility secret`
is rejected.

| Visibility  | Read by web console? | Read by CLI?                                                    | Use for                            |
| ----------- | -------------------- | --------------------------------------------------------------- | ---------------------------------- |
| `plaintext` | yes                  | yes                                                             | non-sensitive config (URLs, flags) |
| `sensitive` | owners + admins only | yes (masked `******` on `env get` unless `--include-sensitive`) | API keys, tokens                   |

Both visibilities are returned by `env export` / `env pull` (they decrypt locally). Visibility gates
_who on your team_ can read the value — it does **not** harden the value against device extraction.
Anything that reaches a JS bundle is extractable; for true secrets use a backend.

## Set / update / get

```bash
better-update env set API_URL=https://api.example.com
better-update env set STRIPE_KEY=sk_live_xxx --visibility sensitive
better-update env set FEATURE_FLAG=true --environment development,production     # CSV: multiple environments
better-update env update STRIPE_KEY --environment staging --visibility sensitive --value sk_test_xxx
better-update env get STRIPE_KEY --environment staging --include-sensitive        # positional is the KEY
```

- `env set <KEY=VALUE>` upserts (creates if missing, updates if it exists). `--environment` defaults
  to `production` and accepts a comma-separated list; `--visibility` is `plaintext` (default) or
  `sensitive`.
- `env update <key>` changes value and/or visibility for one environment (fails if you pass neither).
- `env get <key>` shows the effective (project-over-global) decrypted value. **The positional is the
  KEY name, not an ID.** Sensitive values are masked as `******` unless `--include-sensitive`.

## List / delete

```bash
better-update env list [--environments <csv>] [--scope <all|project|global>] [--search <substr>]
better-update env delete API_URL                       # NO --environment ⇒ deletes the key in EVERY environment
better-update env delete API_URL --environment staging # only that environment
```

`env list` shows Key, Environment, Scope, Visibility, Revisions. `--environments` (note the plural) is
a comma-separated filter and defaults to all environments. `--scope` filters project- vs global-scoped
vars; `--search` filters by key substring.

## History / rollback

Every value change is a revision:

```bash
better-update env history STRIPE_KEY --environment staging          # Revision, Active, Vault, Created, By
better-update env rollback STRIPE_KEY --to <revision> --environment staging
```

`--to` is a revision number (from `env history`) or a revision id.

## Bulk: import / push / export / pull

```bash
better-update env import .env.production                              # KEY=VALUE lines; --visibility/--environment apply to all
better-update env import .env.staging --environment staging --visibility sensitive
better-update env push [.env.local] --environment production         # auto-classify: EXPO_PUBLIC_* → plaintext, others → sensitive
better-update env export --environment production > .env.cached       # prints KEY='value' per line (ALL values)
better-update env pull --environment staging                         # writes .env.local by DEFAULT (KEY="value"), prompts before overwrite
better-update env pull --environment staging --stdout                # prints `export KEY='value'` for shell sourcing
```

- `env import` applies one `--visibility` (default `plaintext`) to every imported line; bump
  individual sensitive ones afterward with `env update … --visibility sensitive`.
- `env push` is the smarter bulk path: it auto-classifies `EXPO_PUBLIC_*` keys as `plaintext` and
  everything else as `sensitive`. The file defaults to `.env.local`.
- `env export` prints all values to stdout. `env pull` **writes a dotenv file by default** (`.env.local`,
  overridable with `--path`, `--force` to skip the overwrite prompt). To source into a shell, use
  `--stdout`: `eval "$(better-update env pull --environment staging --stdout)"`.

## Run a command with vars injected

```bash
better-update env exec staging -- npm run e2e        # runs the command with the env's vars injected; exits with its code
```

## What gets injected at publish time

`update publish --environment <name>` looks up vars in that environment and injects them into the
export. Inside the Expo app, `EXPO_PUBLIC_`-prefixed vars are available as `process.env.EXPO_PUBLIC_*`;
others are injected during build but only where Expo would normally expose them.

```bash
# Production
better-update env set EXPO_PUBLIC_API_URL=https://api.example.com
better-update env set STRIPE_KEY=sk_live_xxx --visibility sensitive
# Staging
better-update env set EXPO_PUBLIC_API_URL=https://staging.api.example.com --environment staging
# Publish — each picks up the right set
better-update update publish --branch production --environment production
better-update update publish --branch staging --environment staging
```

## `environments` — the org's environment definitions

Distinct from `env` (project variables), the top-level **`environments`** command manages which
environment names exist for the organization. Built-in `development`/`preview`/`production` can't be
deleted.

```bash
better-update environments list
better-update environments create qa            # lowercase letters, digits, hyphens
better-update environments rename qa --to staging-2
better-update environments delete qa
```

A var's `--environment` must name an environment that exists in this set.
