# better-update

Self-hosted mobile release platform — OTA updates, native builds, and store submissions for Expo, React Native, Kotlin Multiplatform, and native apps (any project type via custom build commands), running on Cloudflare Workers: served from one of the world's largest edge networks, with no egress fees and a free tier that covers most apps.

What started as an OTA update server has grown into a full release pipeline: build your app locally with EAS-compatible config, manage signing credentials in an end-to-end encrypted vault, ship JS updates through channels with staged rollouts, and submit binaries to the App Store and Google Play — all against your own Cloudflare account.

## Why Cloudflare

OTA updates are a CDN problem: every app launch is a manifest check, and every
release ships bundles and assets to every device. Running that on Cloudflare is
what makes a self-hosted release server cheap enough to be worth self-hosting.

- **Every request is served from the edge.** Workers run in 300+ cities
  worldwide, so manifest checks and asset downloads are answered from a data
  centre near the device instead of a single origin region — no CDN to bolt on,
  no cache tier to configure, no multi-region rollout.
- **No egress fees.** R2 stores update bundles, assets and build artifacts with
  zero bandwidth charges. Bundle downloads are the dominant cost of any OTA
  service, and on R2 they cost nothing to serve — which is exactly why hosted
  alternatives meter them.
- **The free tier covers real apps.** Workers (100k requests/day), D1 (5 GB) and
  R2 (10 GB) fit a small-to-mid app entirely inside free limits; past that,
  usage-based pricing means a few dollars a month, not a per-seat or per-MAU
  plan.
- **Nothing to operate.** No servers, containers or database to patch or scale —
  the whole backend is a Worker, a D1 database, a KV namespace and an R2 bucket,
  created by one bootstrap command.

## Features

### OTA updates

- Expo Updates protocol-compatible update server with code signing
- Branches and channels for routing devices to releases
- Staged rollouts, rollback, revert, republish, and channel promotion
- Fingerprint-based compatibility matrix between builds and updates
- Update insights and per-device tracking

### Native builds

- Local iOS and Android build pipeline mirroring EAS Build, driven by your existing `eas.json` + `app.json` — no separate config format
- Isolated staging builds (fresh install in a temp dir, frozen lockfile)
- Beyond Expo: bare React Native, Kotlin Multiplatform, and custom-command projects via project-type detection
- Store submission from the CLI: App Store upload (altool) and Google Play upload, with submission tracking on the server

### Credentials and secrets

- End-to-end encrypted credential vault (age + per-user keypairs) — the server only ever stores ciphertext; keys never leave your device
- iOS distribution certificates, provisioning profiles, Android keystores, and APNs push key creation/revocation automated from the CLI
- Per-project env vars, E2E-encrypted and versioned, scoped to environments

### Teams and access control

- Multi-org teams with GitHub OAuth or email/password sign-in
- IAM with policies and groups: default-deny, path-scoped permissions for members and API keys
- User-defined environments alongside built-in development/preview/production
- Audit log, analytics, webhooks, scoped API keys

## Deploy your own instance

No account id, hostname or resource id is tracked in this repository — it is not
tied to any deployment. Point a clone at your own Cloudflare account with:

```sh
cp .env.deploy.example .env.deploy   # your account id + hostnames
bun run bootstrap                    # create D1 + KV + R2 on your account
bun run config:gen                   # render wrangler.jsonc + app config
```

Without that file the repo still installs, tests and runs locally on
placeholders — only deploying requires real values.

See [docs/self-hosting.md](./docs/self-hosting.md) for secrets, migrations and deploy.

## Monorepo

| Path          | What it is                                                                          |
| ------------- | ----------------------------------------------------------------------------------- |
| `apps/server` | API on Cloudflare Workers (D1, KV, R2), Effect-based hexagonal core                 |
| `apps/web`    | Dashboard SPA + SSR (TanStack Start)                                                |
| `apps/cli`    | `better-update` CLI — builds, updates, credentials, env vars, submissions           |
| `skills/*`    | Agent skills — `better-update` teaches an agent to drive the CLI end to end         |
| `packages/*`  | Shared libraries: typed API client, Expo protocol, code signing, bsdiff, crypto, UI |

## Agent skill

`skills/better-update` teaches a coding agent to drive the CLI — every command,
flag and the publish → branch → channel → device model. This repository is also
a Claude Code plugin marketplace, so the skill installs in two commands:

```sh
/plugin marketplace add <owner>/better-update   # or a path to your clone
/plugin install better-update@better-update
```

## License

[MIT](./LICENSE.md)
