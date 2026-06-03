# Test Surface Recon — Authorization

## 1. Vitest Project Configuration

`apps/server/vitest.config.ts` declares four projects:

| Project       | Include glob                                   | Setup file          | Runtime                       |
| ------------- | ---------------------------------------------- | ------------------- | ----------------------------- |
| `unit`        | `src/**/*.test.ts`                             | —                   | Node/Bun                      |
| `integration` | `tests/integration/**/*.test.ts`               | `tests/setup-d1.ts` | workerd (vitest-pool-workers) |
| `e2e-pool`    | `tests/e2e/**/*.test.ts` (excl. direct-upload) | `tests/setup-d1.ts` | workerd                       |
| `e2e-pool-r2` | `tests/e2e/direct-upload-flow.test.ts`         | `tests/setup-d1.ts` | workerd + real R2             |

Coverage scope (istanbul, 80% threshold): `src/auth/**/*.ts`, `src/cloudflare/**/*.ts`, `src/domain/**/*.ts`. `src/auth/middleware.ts` is **excluded** (imperative shell).

---

## 2. Unit Tests — `src/auth/`

| File                           | What it covers                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------------- |
| `src/auth/permissions.test.ts` | `permissions` map for all 4 roles; `assertPermission` allow/deny matrix; `assertSuperadmin`         |
| `src/auth/ownership.test.ts`   | `assertOrgOwnership` (org ID match/mismatch); `assertProjectOwnership` (project lookup + cross-org) |
| `src/auth/superadmin.test.ts`  | `parseSuperadminEmails`, `isSuperadminEmail`, `roleIsSuperadmin`                                    |
| `src/auth/password.test.ts`    | `hashPassword` / `verifyPassword` (PBKDF2)                                                          |

### Pattern

All unit auth tests use `Effect.provideService(AuthContext, { ... })` directly — no real D1, no Better Auth calls, no worker runtime. Roles are injected as plain values:

```ts
const provideAuth = (role: Role, overrides?: Partial<EffectivePermissions>, isSuperadmin = false) =>
  Effect.provideService(AuthContext, {
    userId: "test-user",
    organizationId: "test-org",
    role,
    effectivePermissions: { ...permissions[role], ...overrides },
    source: "session",
    transport: "cookie",
    actorEmail: "test@example.com",
    isSuperadmin,
  });
```

`ProjectRepo` is mocked with `Effect.provideService(ProjectRepo, { findOrgIdById: () => Effect.succeed(orgId) })` in `ownership.test.ts`.

---

## 3. Integration Tests Touching Auth/Roles

### `tests/integration/auth-flow.test.ts`

Direct worker dispatch via `createExecutionContext + worker.fetch + waitOnExecutionContext`. Covers sign-up, sign-in, credential rejection. **No org creation or role assignment** — purely auth plumbing.

### D1 setup

`tests/setup-d1.ts` is the single setup file for all integration and e2e-pool projects:

```ts
import { applyD1Migrations, env } from "cloudflare:test";
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
```

`TEST_MIGRATIONS` is injected by `readD1Migrations(path.join(__dirname, "migrations"))` in `vitest.config.ts`. No shell-out, no `wrangler d1 execute` — migrations run entirely in the workerd runtime.

---

## 4. E2E Tests Touching Roles / RBAC (e2e-pool)

### `tests/e2e/auth-flow.test.ts`

Health + unauthenticated-access checks + basic sign-up/sign-in. No org or role.

### `tests/e2e/org-members-flow.test.ts`

Full invite → accept → role-change → remove lifecycle. **Only uses `owner` and `admin` roles via the Better Auth API**:

- Invite with `role: "member"` via `POST /api/auth/organization/invite-member`
- Promote to `admin` via `POST /api/auth/organization/update-member-role`
- Email verification workaround: raw D1 UPDATE `SET "email_verified" = 1` (because email/password sign-up in TEST_MODE leaves the field 0 and the org plugin blocks invitation acceptance for unverified users)

### `tests/e2e/vault-flow.test.ts` — role-gating section (Section 7)

The **only test in the entire suite that sets `developer` role** on a member. Because better-auth's `organization` plugin only recognises `owner | admin | member`, the test falls back to a raw D1 UPDATE:

```ts
await env.DB.prepare(
  `UPDATE "member" SET "role" = 'developer' WHERE "user_id" = (SELECT "id" FROM "user" WHERE "email" = ?) AND "organization_id" = ?`,
)
  .bind(bEmail, organizationId)
  .run();
```

This test then asserts that:

- `GET /api/vault` → 200 (developer can read)
- `POST /api/vault/wraps` → 403 (developer cannot mutate)
- `POST /api/vault` → 403
- `POST /api/vault/rotate` → 403

### `tests/e2e/superadmin-approval-flow.test.ts`

Tests the `admin` plugin's global user role (`user.role`, not `member.role`). Sets `role = 'admin'` on the `user` table via raw D1:

```ts
const setRole = async (userId: string, role: string) =>
  env.DB.prepare(`UPDATE "user" SET "role" = ? WHERE "id" = ?`).bind(role, userId).run();
```

Note: this is a **different column** from `member.role`. This controls the `isSuperadmin` flag on `AuthContext`, not org-scoped permissions.

### `tests/e2e/env-vars-flow.test.ts`

Tests bearer API key transport (no role variation — single owner actor throughout).

### `tests/e2e/updates-flow.test.ts`, `tests/e2e/channels-flow.test.ts`, `tests/e2e/webhooks-flow.test.ts`

These create an API key via `POST /api/auth/api-key/create` and then drive requests with `Authorization: Bearer <key>`. API keys resolve to `effectivePermissions: permissions.admin` in the middleware (no member row needed). No role variation.

---

## 5. Helper Files

### Test infrastructure

| File                               | Role                                                                                                                 |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `tests/helpers/e2e-worker-pool.ts` | `setupE2EWorker()` — HTTP client backed by `worker.fetch`; `parseCookies()`; `seedAssetObject()`                     |
| `tests/helpers/seed-d1.ts`         | `seedD1(sql)` — splits on `;`, batch-executes against `env.DB` (integration tests only, not e2e-pool)                |
| `tests/helpers/runtime.ts`         | `runWithEnv`, `runWithLayerAndEnv` — runs Effect programs in the Cloudflare env (integration helpers)                |
| `tests/helpers/e2e-env.ts`         | `createServerE2EEnvironment()` — builds `processOverrides + workerBindings` for `unstable_startWorker`-based CLI e2e |
| `tests/helpers/mock-d1.ts`         | Mock D1 bindings for unit tests                                                                                      |
| `tests/setup-d1.ts`                | `applyD1Migrations(env.DB, env.TEST_MIGRATIONS)` — one-liner, all migrations auto-applied                            |

### CLI e2e infrastructure

| File                                 | Role                                                                                                                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/cli/tests/helpers/cli-e2e.ts`  | `setupCliE2E(testId, { userEmail, orgSlug })` — signs up a user, creates org, sets active, creates project, creates API key; exposes `runCli`, `seedSql`, `getAuthorized`, `postAuthorized`, etc. |
| `apps/cli/tests/e2e/global-setup.ts` | Starts the shared `unstable_startWorker` server; writes `.wrangler/.e2e-cli-shared-env.json`                                                                                                      |

---

## 6. Auth Bootstrap Pattern (shared across all e2e flows)

Every e2e flow that needs an authenticated actor follows this sequence via the API:

1. `POST /api/auth/sign-up/email` → get `cookies` from `parseCookies(response)`
2. `POST /api/auth/organization/create` → get `organizationId`
3. `POST /api/auth/organization/set-active` → refresh cookies
4. For multi-member flows: `POST /api/auth/organization/invite-member { role: "member" | "admin" }`
5. Second user signs up → raw D1 `UPDATE "user" SET "email_verified" = 1` (TEST_MODE workaround) → re-sign-in → `POST /api/auth/organization/accept-invitation`
6. To set `developer` or `viewer` today: raw D1 `UPDATE "member" SET "role" = '...'`

---

## 7. Auth Transport Coverage

| Transport                        | How authenticated                                                    | Where tested                                              |
| -------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------- |
| Cookie (browser session)         | `cookie: <parseCookies output>` header                               | Every e2e flow                                            |
| Bearer session token (CLI login) | `Authorization: Bearer <session-token>` from `one-time-token/verify` | `env-vars-flow.test.ts`, `cli-session-flow.test.ts`       |
| Bearer API key (CI)              | `Authorization: Bearer bu_<key>` from `api-key/create`               | `updates-flow`, `channels-flow`, `webhooks-flow`, CLI e2e |

---

## 8. Tests That Need Updating After This Change

The central change is: `developer` and `viewer` become assignable via the better-auth API (e.g., `POST /api/auth/organization/update-member-role` accepting the full `Role` union, or a new custom-roles API). Once that lands, the raw D1 UPDATE hacks must be removed and replaced with proper API calls.

### Mandatory updates

| File                                                     | Current pattern                                       | Should become                                                                                                                    |
| -------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `tests/e2e/vault-flow.test.ts` (Section 7, line 415–419) | Raw D1 `UPDATE "member" SET "role" = 'developer'`     | `POST /api/auth/organization/update-member-role { role: "developer" }` (or the new role-assignment endpoint)                     |
| `tests/e2e/org-members-flow.test.ts` (line 122)          | Asserts `bob.role === "member"` (better-auth default) | Still valid if `"member"` maps to an internal sentinel; if the built-in `member` role is replaced with `viewer`, update to match |

### Likely additions

- A new e2e file (or additional sections in `org-members-flow.test.ts`) covering `developer` and `viewer` role assignments and their RBAC boundaries (read-only for viewer; create/update but not delete for developer).
- `permissions.test.ts` — add `it.each` rows for any new permission combinations if the permissions map changes.
- Integration-level RBAC coverage testing that `assertPermission` fires 403 correctly end-to-end via the handler stack (currently only unit-tested with mocked `AuthContext`).

### Raw D1 patterns that are legitimate workarounds (not hacks, should keep)

- `UPDATE "user" SET "email_verified" = 1` — this is a TEST_MODE limitation of email/password sign-up; not related to authorization roles. Keep unless better-auth adds a test API for verification.
- `UPDATE "user" SET "approved" = ?` / `UPDATE "user" SET "role" = ?` in `superadmin-approval-flow.test.ts` — these update the global `admin` plugin's `user` table columns, not org-scoped member roles. No better-auth client API exists for this today.

---

## 9. Inventory of `docs/specs/authz/recon/` Sibling Files

| File                       | Content                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------ |
| `consumer-surface.md`      | API contract patterns for new role/grant endpoints; auth-client type widening needed |
| `handler-scope-surface.md` | Every `assertPermission` call site mapped to handler + line number                   |
| `schema-migration.md`      | D1 schema changes for custom roles                                                   |
