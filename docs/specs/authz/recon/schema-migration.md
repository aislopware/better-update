# Schema & Migration Conventions — Authorization Tables

Recon document for the `organization_role` and `environment_grant` tables.
Covers existing table shapes, naming conventions, and draft DDL for the two new tables.

---

## 1. Existing Table: `member`

Source: `apps/server/migrations/0001_auth.sql`

```sql
CREATE TABLE "member" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "organization_id" TEXT NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  "user_id"         TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "role"            TEXT NOT NULL,
  "created_at"      DATE NOT NULL
);

CREATE INDEX "member_organization_id_idx" ON "member" ("organization_id");
CREATE INDEX "member_user_id_idx"         ON "member" ("user_id");
```

Key points:

- PK: `id TEXT` (nanoid/cuid2 text, same as all other better-auth tables)
- FK to `organization` and `user`, both `ON DELETE CASCADE`
- `role` is a plain `TEXT` column (better-auth writes `owner`/`admin`/`member`; the project sets `developer`/`viewer` via direct D1 UPDATE — see `project_org_roles_assignable.md`)
- No `updated_at` (better-auth omits it on member)
- `created_at` typed as `DATE` (better-auth convention; app tables use `TEXT` with ISO-8601 default)

---

## 2. Existing Table: `channels`

Source: `apps/server/migrations/0002_app.sql`

```sql
CREATE TABLE "channels" (
  "id"                  TEXT NOT NULL PRIMARY KEY,
  "project_id"          TEXT NOT NULL REFERENCES "projects" ("id"),
  "name"                TEXT NOT NULL,
  "branch_id"           TEXT NOT NULL REFERENCES "branches" ("id"),
  "branch_mapping_json" TEXT,
  "cache_version"       INTEGER NOT NULL DEFAULT 0,
  "is_paused"           INTEGER NOT NULL DEFAULT 0,
  "created_at"          TEXT NOT NULL,
  UNIQUE ("project_id", "name")
);

CREATE INDEX "idx_channels_branch_project" ON "channels" ("branch_id", "project_id");
```

Key points:

- PK: `id TEXT` (same pattern)
- `environment_grant.scope_id` will FK to `channels.id` when `scope_kind = 'channel'`
- No `organization_id` directly on `channels`; org is reached through `projects`
- `created_at` is `TEXT` (ISO-8601 string, consistent with all app tables post-0002)

---

## 3. Migration Naming & Numbering Conventions

### Naming pattern

```
NNNN_<slug>.sql
```

- `NNNN` — zero-padded 4-digit sequence number (0001, 0002, …, 0053)
- `<slug>` — snake*case description, words separated by `*`, no camelCase
- Examples: `0001_auth.sql`, `0048_env_vars_per_environment.sql`, `0053_user_approval_and_admin.sql`

### Next migration number

Latest migration: `0053_user_approval_and_admin.sql`
**Next number: `0054`**

New files should be named:

- `0054_organization_role.sql` (better-auth dynamic AC table)
- `0055_environment_grant.sql` (environment-scoped permission grants)

Or combined into one file if shipped together:

- `0054_authz_grants.sql`

### Style conventions (from 0001, 0048, 0053)

- Opening block comment explains purpose + context (`-- <description>`)
- Multi-line: table comments in `--` above each `CREATE TABLE`
- Double-quoted identifiers: `"column_name"` always
- snake_case for all table and column names
- Booleans: `INTEGER NOT NULL DEFAULT 0` (SQLite has no `BOOLEAN`)
- Timestamps: `TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))` for app tables; better-auth tables use bare `DATE NOT NULL` (no default — better-auth sets the value in code)
- PKs always `TEXT NOT NULL PRIMARY KEY` (nanoid/cuid2)
- FKs always explicit `REFERENCES "table" ("id")` with `ON DELETE CASCADE` where orphan cleanup is desired
- Indexes named `idx_<table>_<columns>` for app tables; better-auth uses `<table>_<column>_idx`
- `CREATE UNIQUE INDEX` preferred over inline `UNIQUE` for partial-index expressions
- `DROP TABLE IF EXISTS` / `DROP INDEX IF EXISTS` only in destructive-recreate migrations (rare, documented with a "no prod rows" justification comment — see 0048)
- No semicolons inside string literals or comments (D1 batch seed constraint — does **not** affect migration files, which D1 applies one statement at a time via `readD1Migrations`)

---

## 4. Migration Application

### Dev (local)

```bash
bun run d1:migrate
# expands to: wrangler d1 migrations apply DB --local
```

Wrangler reads `migrations_dir: "migrations"` from `wrangler.jsonc`, applies unapplied files in numeric order, and records state in the local D1 at `.wrangler/state/v3/d1/`.

### Integration tests (vitest-pool-workers)

`vitest.config.ts` calls `readD1Migrations(path.join(__dirname, "migrations"))` at startup and passes the result as the `TEST_MIGRATIONS` miniflare binding. The global setup file `tests/setup-d1.ts` runs:

```ts
import { applyD1Migrations, env } from "cloudflare:test";
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
```

Both `integration` and `e2e-pool` projects share this setup file. New migrations are picked up automatically — no config change needed.

### E2E (pool-backed, `e2e-pool` / `e2e-pool-r2`)

Same mechanism as integration: `readD1Migrations` + `setup-d1.ts`. The `e2e-pool` and `e2e-pool-r2` vitest projects both use `setupFiles: ["./tests/setup-d1.ts"]`.

CLI e2e (the separate `unstable_startWorker`-based suite) applies migrations via `wrangler d1 migrations apply` before the worker starts — handled by the E2E env helper (`tests/helpers/e2e-env.ts`).

---

## 5. Draft DDL — New Tables

### 5a. `organization_role` (better-auth dynamic Access Control)

> **Placeholder** — exact column set depends on the `betterauth-ac-api` recon
> (see `betterauth-ac-api.md` when written). The shell below captures the
> minimum structure; update once the better-auth `ac` plugin schema is confirmed.

```sql
-- Dynamic Access Control role table required by the better-auth `ac` plugin.
-- Exact columns TBD: see docs/specs/authz/recon/betterauth-ac-api.md.
-- PLACEHOLDER — do not ship until columns are confirmed.

CREATE TABLE "organization_role" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "organization_id" TEXT NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  "name"            TEXT NOT NULL,
  -- <additional columns from better-auth ac plugin to be added here>
  "created_at"      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE ("organization_id", "name")
);

CREATE INDEX "idx_organization_role_org"
  ON "organization_role" ("organization_id");
```

### 5b. `environment_grant`

Environment-scoped permission grant. One row = one member's allow/deny statement
for a set of actions on a scope (organization-wide, project, or channel).

```sql
-- Environment-scoped permission grants.
-- A grant binds a member to a scope (org/project/channel) and declares
-- which actions are allowed or denied on that scope.
--
-- scope_kind IN ('organization','project','channel'):
--   'organization' → scope_id = organization.id   (org-wide)
--   'project'      → scope_id = projects.id
--   'channel'      → scope_id = channels.id
--
-- effect IN ('allow','deny'):
--   'allow' grants actions; 'deny' explicitly revokes.
--
-- actions: JSON array of action strings, e.g. '["publish","rollback"]'

CREATE TABLE "environment_grant" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "organization_id" TEXT NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  "member_id"       TEXT NOT NULL REFERENCES "member" ("id") ON DELETE CASCADE,
  "scope_kind"      TEXT NOT NULL CHECK ("scope_kind" IN ('organization', 'project', 'channel')),
  "scope_id"        TEXT NOT NULL,
  "effect"          TEXT NOT NULL CHECK ("effect" IN ('allow', 'deny')),
  "actions"         TEXT NOT NULL,  -- JSON array: '["publish","rollback",...]'
  "created_at"      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Primary lookup: all grants for a member within an org
CREATE INDEX "idx_environment_grant_member"
  ON "environment_grant" ("organization_id", "member_id");

-- Scope-side lookup: all grants on a particular scope object
CREATE INDEX "idx_environment_grant_scope"
  ON "environment_grant" ("scope_kind", "scope_id");

-- Prevent duplicate allow+deny rows for same (member, scope, effect)
-- (application layer must enforce action-level uniqueness within the JSON array)
CREATE UNIQUE INDEX "idx_environment_grant_unique"
  ON "environment_grant" ("member_id", "scope_kind", "scope_id", "effect");
```

**Notes on `scope_id` FK:**

- SQLite does not support polymorphic FK constraints. The application (or a repository
  layer CHECK trigger) must validate that `scope_id` references the correct table for
  the given `scope_kind`.
- The `idx_environment_grant_scope` index supports efficient revocation sweeps when
  a channel or project is deleted (application must `DELETE FROM environment_grant
WHERE scope_kind = ? AND scope_id = ?` in the same transaction as the parent delete).
- Alternatively, a per-`scope_kind` partial index can be added later if query plans
  show hot paths.

---

## 6. snake_case Mapping Pattern

Better-auth generates TypeScript fields in camelCase and maps them to snake_case
column names via its schema adapter. The pattern used in this codebase:

| TypeScript / better-auth field | D1 column                |
| ------------------------------ | ------------------------ |
| `organizationId`               | `organization_id`        |
| `userId`                       | `user_id`                |
| `createdAt`                    | `created_at`             |
| `updatedAt`                    | `updated_at`             |
| `emailVerified`                | `email_verified`         |
| `activeOrganizationId`         | `active_organization_id` |
| `accessToken`                  | `access_token`           |
| `refreshToken`                 | `refresh_token`          |
| `expiresAt`                    | `expires_at`             |
| `rateLimitMax`                 | `rate_limit_max`         |
| `requestCount`                 | `request_count`          |

Rule: every camelCase word boundary becomes `_` + lowercase. No exceptions.
App tables follow the same convention (see `env_vars`, `user_encryption_keys`, etc.).
