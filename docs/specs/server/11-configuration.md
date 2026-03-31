# 14. Wrangler Configuration

## apps/api/wrangler.jsonc

| Setting               | Value               |
| --------------------- | ------------------- |
| `name`                | `better-update-api` |
| `main`                | `src/index.ts`      |
| `compatibility_date`  | `2026-03-30`        |
| `compatibility_flags` | `nodejs_compat`     |

**Bindings:**

| Type             | Binding Name                | Resource                          |
| ---------------- | --------------------------- | --------------------------------- |
| D1               | `DB`                        | `better-update-db`                |
| R2               | `ASSETS_BUCKET`             | `better-update-assets`            |
| KV               | `CACHE`                     | Channel mapping cache             |
| KV               | `SESSION_KV`                | Better Auth session storage       |
| Durable Object   | `PUBLISH_COORDINATOR`       | class `PublishCoordinator`        |
| Durable Object   | `CREATE_BRANCH_COORDINATOR` | class `CreateBranchCoordinator`   |
| Queue (producer) | `PATCH_QUEUE`               | `patch-gen` queue                 |
| Analytics Engine | `ANALYTICS`                 | `better-update-analytics` dataset |

**DO Migration:** tag `v1`, `new_sqlite_classes: ["PublishCoordinator", "CreateBranchCoordinator"]`

## Environment Variables

**Vars (non-secret, in wrangler.jsonc):**

| Variable          | Purpose                                                            |
| ----------------- | ------------------------------------------------------------------ |
| `BETTER_AUTH_URL` | Base URL for Better Auth (e.g., `https://api.updates.example.com`) |
| `SIGNING_ENABLED` | `"true"` to enable code signing pass-through                       |

**Secrets (via `wrangler secret put`):**

| Secret                 | Purpose                                            |
| ---------------------- | -------------------------------------------------- |
| `BETTER_AUTH_SECRET`   | Better Auth signing secret (sessions, cookies)     |
| `GITHUB_CLIENT_ID`     | GitHub OAuth app client ID                         |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth app client secret                     |
| `CLOUDFLARE_ZONE_ID`   | Zone ID for cache purge API calls (optional)       |
| `CLOUDFLARE_API_TOKEN` | API token with "Cache Purge" permission (optional) |

Note: The legacy `API_KEY` secret is removed. Organization-scoped API keys (managed by Better Auth) replace the global Worker secret. See [spec 21](./21-authentication.md).

## Queue Consumer

| Setting             | Value           |
| ------------------- | --------------- |
| `queue`             | `patch-gen`     |
| `max_batch_size`    | `10`            |
| `max_retries`       | `3`             |
| `dead_letter_queue` | `patch-gen-dlq` |

The queue consumer handles asynchronous patch generation for bundle diffing. See [spec 19](./19-bundle-diffing.md).

## Cron Triggers

| Cron expression | Purpose                                       |
| --------------- | --------------------------------------------- |
| `0 3 * * *`     | Patch garbage collection (daily at 03:00 UTC) |
