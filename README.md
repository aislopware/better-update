# better-update

Self-hosted mobile release platform — OTA updates, native builds, and store submissions for Expo and React Native apps, running on Cloudflare Workers.

What started as an OTA update server has grown into a full release pipeline: build your app locally with EAS-compatible config, manage signing credentials in an end-to-end encrypted vault, ship JS updates through channels with staged rollouts, and submit binaries to the App Store and Google Play — all against your own Cloudflare account.

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

## Monorepo

| Path          | What it is                                                                          |
| ------------- | ----------------------------------------------------------------------------------- |
| `apps/server` | API on Cloudflare Workers (D1, KV, R2), Effect-based hexagonal core                 |
| `apps/web`    | Dashboard at [better-update.dev](https://better-update.dev) (TanStack Start)        |
| `apps/cli`    | `better-update` CLI — builds, updates, credentials, env vars, submissions           |
| `apps/docs`   | Documentation site                                                                  |
| `packages/*`  | Shared libraries: typed API client, Expo protocol, code signing, bsdiff, crypto, UI |

## License

[PolyForm Noncommercial 1.0.0](./LICENSE.md) — free for personal, research, educational, nonprofit. Commercial use needs separate license.
