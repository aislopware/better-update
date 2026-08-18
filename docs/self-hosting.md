# Self-hosting

This repository is **deployment-neutral**: no account id, zone id, hostname,
database id or contact address for any particular instance is tracked in git.
Everything that ties a checkout to one Cloudflare account lives outside it.

```
process.env                   CI variables — highest precedence (BU_* keys only)
.env.deploy                   ignored — YOUR instance
(generic fallbacks in code)   resource NAMES only, never identity
```

A clone with nothing configured still installs, typechecks, tests and runs
`vite dev`: `config:gen` substitutes obvious placeholders (`localhost`,
all-zero ids) and prints a warning. Deploying refuses them — `deploy` and
`d1:migrate:remote` resolve the config in strict mode and fail on a placeholder.

`bun run config:gen` renders those values into git-ignored artifacts. Never edit
these by hand — they are overwritten on every install, dev run and deploy:

| Generated file                                        | Rendered from               |
| ----------------------------------------------------- | --------------------------- |
| `apps/server/wrangler.jsonc`                          | `config/wrangler/server.ts` |
| `apps/web/wrangler.jsonc`                             | `config/wrangler/web.ts`    |
| `apps/web/src/lib/site-config.generated.ts`           | deploy config               |
| `apps/cli/src/services/service-defaults.generated.ts` | deploy config               |

To change the **shape** of a Worker config (add a binding, a route, a cron), edit
the template under `config/wrangler/`. To change the **values**, edit `.env.deploy`.
The full key list, with which ones are required, is `.env.deploy.example`.

## Deploying your own instance

### 1. Point the repo at your account

```sh
cp .env.deploy.example .env.deploy
```

Seven keys are required: `BU_CF_ACCOUNT_ID`, `BU_APP_HOST`, `BU_ASSET_CDN_HOST`,
`BU_EMAIL_SENDER` and the three resource ids that step 2 fills in. Everything
else has a generic fallback or is off when empty.

A **custom domain is required for the dashboard**: the server and web workers are
separate deployments that share one origin, split by route (`/api/*` → server,
everything else → web). Leave `BU_CF_ZONE_ID` empty and the generator drops every
route and enables `workers.dev` — the two workers then land on different origins,
so the dashboard's same-origin API calls will not resolve. That mode is only
useful for an API-only instance driven by the CLI, with `BU_APP_HOST` set to the
server worker's `*.workers.dev` host.

### 2. Create the Cloudflare resources

```sh
bunx wrangler login          # or export CLOUDFLARE_API_TOKEN
bun run bootstrap            # add --dry-run to see the commands first
```

This creates the D1 database, both KV namespaces and the R2 buckets (including
the `-e2e` preview buckets the R2 test suite needs), then writes the resulting
ids back into `.env.deploy`. It is safe to re-run: existing resources are looked
up rather than recreated.

It also sets the CORS rule on the assets bucket that lets the browser PUT logos
and avatars to a presigned URL, allowing `BU_APP_HOST` and — when set —
`BU_VAULT_HOST`. That rule lives on the bucket rather than in `wrangler.jsonc`,
so re-run `bun run bootstrap` after changing either hostname or after recreating
the bucket; otherwise logo uploads fail the preflight with a CORS error.

### 3. Render the config

```sh
bun run config:gen
```

Also runs automatically on `bun install` and before every `dev`, `deploy`,
`typegen:cf` and the CLI `build`.

### 4. Set the secrets

Secrets never live in the deploy config. Set them per worker:

```sh
cd apps/server
bunx wrangler secret put BETTER_AUTH_SECRET       # openssl rand -base64 32
bunx wrangler secret put INSTALL_TOKEN_SECRET
bunx wrangler secret put R2_SECRET_ACCESS_KEY     # pairs with BU_R2_ACCESS_KEY_ID
bunx wrangler secret put GITHUB_CLIENT_SECRET     # only if BU_GITHUB_CLIENT_ID is set
bunx wrangler secret put GOOGLE_CLIENT_SECRET     # only if BU_GOOGLE_CLIENT_ID is set
```

None of the deploy-config values are secrets in the cryptographic sense — an
account id, a zone id, a database uuid or an R2 access key **id** is useless
without a matching API token. They stay out of git because they describe _one
operator's_ infrastructure, not because leaking them grants access.

### 5. Migrate and deploy

```sh
cd apps/server && bun run d1:migrate:remote && bun run deploy
cd ../web && bun run deploy
```

Sign in with an address listed in `BU_SUPERADMIN_EMAILS` — that account is
auto-promoted to superadmin on first login and can approve everyone else.

### 6. Point the CLI at your server

`bun run config:gen` bakes your `BU_APP_HOST` into the CLI defaults, so a CLI
built from your fork already targets your instance. Users of a CLI built
elsewhere can override it per machine:

```sh
export BETTER_UPDATE_URL=https://updates.example.com
export BETTER_UPDATE_ASSET_CDN_URL=https://updates.example.com
```

## Notes

- **CI.** `.gitlab-ci.yml` is the whole pipeline (test → release → deploy →
  publish) and names no particular GitLab instance, registry or runner, so a
  fork runs it unmodified. A pipeline that deploys supplies the same keys as
  CI/CD variables; the environment wins over `.env.deploy`, and `turbo.json`
  passes `BU_*` through. Test and lint jobs need none of them — they run on
  placeholders. Four `BU_CI_*` variables describe the runners, not the deployment
  (`config:gen` ignores them). `BU_CI_LINUX_TAG` / `BU_CI_MACOS_TAG` are
  **required** — their tracked values are placeholders, and a job whose tag
  matches no runner sits pending forever. `BU_CI_IMAGE` (Linux image) and
  `BU_CI_MACOS_IMAGE` (macOS VM) are optional. The Linux jobs bootstrap their own toolchain on a plain `node:24-bookworm`;
  building `ci/Dockerfile` and pointing `BU_CI_IMAGE` at it turns every install
  step into a no-op. Only the two bsdiff jobs need a macOS runner — the rest of
  the pipeline is Linux.
- **Legal pages.** `/terms` and `/privacy` are the upstream operator's documents
  (governed by Vietnamese law, naming the upstream operator). If you run a public
  instance, rewrite `apps/web/src/routes/{terms,privacy}.tsx` for your own entity
  and jurisdiction — only the contact address is configuration (`BU_LEGAL_EMAIL`).
- **Email.** Invitation email goes out through Cloudflare Email Routing from
  `BU_EMAIL_SENDER`; that address must be verified on your zone or sending fails.
- **Vault origin.** `BU_VAULT_HOST` is an isolated origin for the env-vault
  unlock UI (its own CSP, its own storage). Leave it empty to disable it — vault
  mutations then stay CLI-only, and the flow is still exercisable on `*.localhost`
  in local development.
- **Asset CDN.** `BU_ASSET_CDN_HOST` is the public origin of the assets R2
  bucket — attach a custom domain to it on your zone. It cannot fall back to
  `BU_APP_HOST`: the Worker has no `/assets/*` route, so that host serves the
  dashboard SPA and every OTA asset would 404.
- **Stale config.** `@cloudflare/vite-plugin` writes `.wrangler/deploy/config.json`,
  a redirect that makes `wrangler` read the config from the last build. `config:gen`
  deletes that redirect whenever it rewrites a `wrangler.jsonc`, so a changed id
  can never be silently ignored by a later deploy.
