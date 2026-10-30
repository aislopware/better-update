# 14. Worker Configuration

## apps/server/cloudflare.config.ts

| Setting             | Value                                            |
| ------------------- | ------------------------------------------------ |
| `name`              | `better-update-server`                           |
| `entrypoint`        | `src/index.ts`                                   |
| `compatibilityDate` | `2026-10-23` (Node.js compatibility is built in) |

**Bindings:**

| Type             | Binding Name                | Resource                          |
| ---------------- | --------------------------- | --------------------------------- |
| D1               | `DB`                        | `better-update-db`                |
| R2               | `ASSETS_BUCKET`             | `better-update-assets`            |
| KV               | `CACHE`                     | Channel mapping cache             |
| KV               | `SESSION_KV`                | Better Auth session storage       |
| Durable Object   | `PUBLISH_COORDINATOR`       | class `PublishCoordinator`        |
| Durable Object   | `CREATE_BRANCH_COORDINATOR` | class `CreateBranchCoordinator`   |
| Analytics Engine | `ANALYTICS`                 | `better-update-analytics` dataset |

**DO exports:** `PublishCoordinator` and `CreateBranchCoordinator`, both `exports.durableObject({ storage: "sqlite" })` (created by the Wrangler-era migration tag `v1`, `new_sqlite_classes`)

## Environment Variables

**Vars (non-secret, `bindings.text` in cloudflare.config.ts):**

| Variable          | Purpose                                                            |
| ----------------- | ------------------------------------------------------------------ |
| `BETTER_AUTH_URL` | Base URL for Better Auth (e.g., `https://api.updates.example.com`) |
| `SIGNING_ENABLED` | `"true"` to enable code signing pass-through                       |

**Secrets (via `wrangler secret put`):**

| Secret                 | Purpose                                            |
| ---------------------- | -------------------------------------------------- |
| `BETTER_AUTH_SECRET`   | Better Auth signing secret (sessions, cookies)     |
| `GITHUB_CLIENT_ID`     | GitHub OAuth app client ID (optional)              |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth app client secret (optional)          |
| `GOOGLE_CLIENT_ID`     | Google OAuth client ID (optional)                  |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret (optional)              |
| `CLOUDFLARE_ZONE_ID`   | Zone ID for cache purge API calls (optional)       |
| `CLOUDFLARE_API_TOKEN` | API token with "Cache Purge" permission (optional) |

Note: The legacy `API_KEY` secret is removed. Organization-scoped API keys (managed by Better Auth) replace the global Worker secret. See [spec 21](./21-authentication.md).

## Cron Triggers

| Cron expression | Purpose                                   |
| --------------- | ----------------------------------------- |
| `0 3 * * *`     | Build artifact garbage collection (daily) |
