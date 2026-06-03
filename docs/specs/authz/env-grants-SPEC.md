# SPEC — Per-environment ABAC scoping of the env-var vault (`env_var_environment` grants)

Status: ready for implementation. Author: spec-author agent. Date: 2026-06-03.

> Implementer agents MUST follow this spec file-by-file, in the order given. Every
> file path is absolute. Every signature, SQL block, and constant name is
> load-bearing — reproduce them exactly. Do NOT improvise alternative shapes.

---

## 0. Summary & intent

Today, env-var handlers gate org-wide with `assertPermission("envVar", action)`. We
add a **per `(project × environment)` ABAC scope layer** on top of the EXISTING L3
ABAC machinery:

- table `environment_grant` (migration `0055`),
- function `assertPermissionOn` in `apps/server/src/auth/scope.ts`,
- deny-wins resolution.

**The ABAC engine itself stays UNCHANGED.** We only:

1. add a new `ScopeKind` value `env_var_environment`,
2. widen the `scope_kind` CHECK on `environment_grant` via a NEW migration,
3. add one repo read method (`findForMemberByScopeKind`),
4. wire per-environment scoped asserts into every env-var handler,
5. add an `env-grants` API group + management handler + web page + CLI commands,
6. add unit + e2e tests.

The scope granularity is `project × environment`. The grant `scope_id` is built by
ONE exported helper (see §2). Org-global env vars use a named sentinel token
(`"global"`) in place of a project id.

---

## 1. House Rules (MUST obey — violating any of these fails review)

- **Package manager**: `bun` / `bunx` ONLY. Never `npm`, `npx`, `yarn`.
- **Lint + typecheck**: `bun run lint` from repo root. Never run `tsc` / `tsgo` /
  `oxlint` directly. Format = `oxfmt` via `bun run format`.
- **Imports are EXTENSIONLESS** — no `.ts` / `.tsx` in import paths.
- **Effect everywhere**: errors as values, no `throw` in handlers.
  `Effect.promise` / `Effect.tryPromise` ONLY in `repositories/` and
  `cloudflare/*Live`. Compose Effect services elsewhere.
- **Hexagonal layers** under `apps/server/src`: `domain/` `http/` `lib/`
  `protocol/` stay PURE; `repositories/` = `Context.Tag` port + D1 `Live`
  colocated; `application/` = orchestration; `handlers/` = `HttpApiBuilder.group`
  imperative shell. **No new top-level dir.** Handlers may yield repos + auth +
  domain. No direct `env.DB` outside `repositories/` or `cloudflare/*Live`.
- **Web** (`apps/web`): `@base-ui/react` + coss components ONLY, never
  `@radix-ui`. coss canonical names (`Menu*` not `DropdownMenu*`, `Button`
  `loading` prop, `Spinner`, `InputGroup`, coss `Field` with the `invalid`
  boolean prop). Paginated lists use `lib/data-table` primitives. List/filter
  state goes in TanStack Router `validateSearch`, not `useState`. Data fetching
  uses the typed api-client via `runApi()`, never raw `fetch`. Dialog-with-form:
  lift `open`+`resetKey` to caller, key-bump on `onOpenChangeComplete`;
  cancel/close buttons use `variant="ghost"`. JSX depth cap is 9 (extract
  subtrees). `Field` gets `invalid` prop, not raw `data-invalid`.
- **CLI** (`apps/cli`): citty. Declare POSITIVE boolean flags with a default
  (citty `--no-foo` negates `foo`); never name a flag `no-foo`.
- **Tests**: vitest globals (`describe`/`test`/`expect` — do NOT import from
  `vitest`). Effect programs use `@effect/vitest` (`it.effect` / `it.scoped`) and
  `Effect.provideService` (NOT `vi.mock`). Unit tests colocated as
  `src/**/*.test.ts`. Integration/e2e live in `apps/server/tests/`. Do NOT test
  framework built-ins.
- **Lint disable**: fix root cause first. No rule overrides in package
  `.oxlintrc.json`. Inline `// eslint-disable-next-line <rule> -- <reason>` is last
  resort and the `-- <reason>` is mandatory.
- **Do NOT commit, do NOT `git --no-verify`.** Leave the working tree dirty for
  the user to review.

---

## 2. `scope_id` format (the single source of truth)

### 2.1 Sentinel + builder

The grant `scope_id` for an `env_var_environment` grant is:

```
<project-id-or-GLOBAL>:<environment>
```

- `<project-id-or-GLOBAL>` is the **project id** when the env var is
  project-scoped, OR the literal sentinel token `"global"` when the env var is
  org-global.
- `<environment>` is one of `development` | `preview` | `production`.

**The global sentinel MUST be a named exported constant — never inline the literal
`"global"` at a call site.**

Define both the sentinel and the builder/parser in `apps/server/src/auth/scope.ts`
(the generic ABAC home). Keep them framework-agnostic (no repo, no I/O).

Add to the BOTTOM of `apps/server/src/auth/scope.ts` (do NOT touch
`assertPermissionOn`):

```ts
import type { EnvVarEnvironment } from "../models";

/** Sentinel project-id segment for an org-global env-var scope. */
export const ENV_VAR_GLOBAL_SENTINEL = "global" as const;

/** scope_kind value for per (project × environment) env-var grants. */
export const ENV_VAR_SCOPE_KIND = "env_var_environment" as const;

/**
 * Build the `env_var_environment` scope id from (projectId-or-null, environment).
 * `null` projectId means the org-global vault → the `ENV_VAR_GLOBAL_SENTINEL`
 * segment. Format: `<projectId|global>:<environment>`.
 */
export const buildEnvVarScopeId = (
  projectId: string | null,
  environment: EnvVarEnvironment,
): string => `${projectId ?? ENV_VAR_GLOBAL_SENTINEL}:${environment}`;

/**
 * Inverse of {@link buildEnvVarScopeId}. Returns the project-id segment (or the
 * sentinel) and the environment. Splits on the FIRST colon only — a project id
 * never contains a colon, and the environment is a fixed token, so this is total
 * for well-formed ids.
 */
export const parseEnvVarScopeId = (
  scopeId: string,
): { readonly project: string; readonly environment: string } => {
  const idx = scopeId.indexOf(":");
  return idx === -1
    ? { project: scopeId, environment: "" }
    : { project: scopeId.slice(0, idx), environment: scopeId.slice(idx + 1) };
};
```

> Rationale for split-on-first-colon: D1 ids (`crypto.randomUUID()`) never contain
> `:`, and the sentinel `"global"` does not either, so the first `:` always
> delimits project segment from environment. `parseEnvVarScopeId` is used by the
> list resolver (§7) and unit-tested in §11.

### 2.2 Action tokens

The env-var action tokens are the exact strings:

```
envVar:read   envVar:create   envVar:update   envVar:delete
```

These match `resource:action` where `resource = "envVar"` is a real `Resource`
(see `apps/server/src/authz-models.ts` and `permissions.ts`). The
`assertEnvVarScopedPermission` helper (§6) constructs them from `("envVar", action)`
via `assertPermissionOn`.

---

## 3. `apps/server/src/authz-models.ts` — widen `ScopeKind`

**Edit** the `ScopeKind` type. Current:

```ts
export type ScopeKind = "channel";
```

Replace with the union of the two string literals:

```ts
export type ScopeKind = "channel" | "env_var_environment";
```

No other change in this file. `EnvironmentGrantModel.scopeKind` already references
`ScopeKind`, so it widens automatically. The `EnvironmentGrantRow` adapter type in
`environment-grant-repo.ts` (typed `scope_kind: ScopeKind`) also widens
automatically — the new migration's CHECK guarantees the column holds only the two
values, so no per-row narrowing assertion is needed.

---

## 4. Migration — NEW file `apps/server/migrations/0056_env_var_environment_grant.sql`

Highest existing migration is `0055_environment_grant.sql`. The next integer is
`0056`. **Do NOT edit `0055`.** Create a NEW file:

`apps/server/migrations/0056_env_var_environment_grant.sql`

SQLite cannot `ALTER` a `CHECK`, so REBUILD the table: rename existing to a temp
name, recreate fresh reproducing EVERY column / FK / default EXACTLY as `0055` but
with the widened CHECK, copy rows via `INSERT ... SELECT`, drop the temp table,
then recreate ALL THREE indexes from `0055`.

Exact contents (reproduce verbatim — columns/FKs/default mirror `0055` exactly):

```sql
-- Widen the environment_grant.scope_kind CHECK to admit 'env_var_environment'
-- alongside the original 'channel'. SQLite cannot ALTER a CHECK constraint, so we
-- rebuild the table: rename → recreate (same columns/FKs/default as 0055, new
-- CHECK) → copy rows → drop old → recreate all three indexes.
-- See docs/specs/authz/env-grants-SPEC.md section 4.

ALTER TABLE "environment_grant" RENAME TO "environment_grant_old";

CREATE TABLE "environment_grant" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "organization_id" TEXT NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  "member_id"       TEXT NOT NULL REFERENCES "member" ("id") ON DELETE CASCADE,
  "scope_kind"      TEXT NOT NULL CHECK ("scope_kind" IN ('channel', 'env_var_environment')),
  "scope_id"        TEXT NOT NULL,
  "effect"          TEXT NOT NULL CHECK ("effect" IN ('allow', 'deny')),
  "actions"         TEXT NOT NULL,
  "created_at"      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO "environment_grant"
  ("id", "organization_id", "member_id", "scope_kind", "scope_id", "effect", "actions", "created_at")
SELECT
  "id", "organization_id", "member_id", "scope_kind", "scope_id", "effect", "actions", "created_at"
FROM "environment_grant_old";

DROP TABLE "environment_grant_old";

-- Recreate all three indexes from 0055 (identical definitions).
CREATE INDEX "idx_environment_grant_member_scope"
  ON "environment_grant" ("member_id", "scope_kind", "scope_id");

CREATE INDEX "idx_environment_grant_scope"
  ON "environment_grant" ("scope_kind", "scope_id");

CREATE UNIQUE INDEX "idx_environment_grant_unique"
  ON "environment_grant" ("member_id", "scope_kind", "scope_id", "effect");
```

> Notes:
>
> - The temp name is `environment_grant_old`.
> - The `INSERT ... SELECT` enumerates columns explicitly (not `SELECT *`) so the
>   copy is order-stable.
> - Defaults/FKs/`ON DELETE CASCADE` are copied verbatim from `0055`.
> - No migration runner registration step is needed beyond placing the file (the
>   e2e harness applies migrations from the dir via CLI; integration uses the
>   pool's auto-apply). Confirm the migration list is glob-based — it is.

---

## 5. Repo — `apps/server/src/repositories/environment-grant-repo.ts`

Add ONE new read method to BOTH the port interface and the `Live` adapter.

### 5.1 Port — add to `EnvironmentGrantRepository`

Insert after `findByScope` (keep ordering: scope-object lookups grouped):

```ts
  /**
   * All grants for ONE member across ALL scope ids of ONE scope_kind. Used by
   * `resolveEnvReadPredicate` to build an in-memory deny-wins predicate over many
   * (project × environment) scopes in a single query — the list handler cannot
   * call the single-shot scoped assert per row.
   */
  readonly findForMemberByScopeKind: (params: {
    readonly memberId: string;
    readonly scopeKind: ScopeKind;
  }) => Effect.Effect<readonly EnvironmentGrantModel[]>;
```

### 5.2 Live adapter — add to `EnvironmentGrantRepoLive`

Insert after `findByScope` implementation:

```ts
  findForMemberByScopeKind: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${GRANT_COLUMNS} FROM "environment_grant" WHERE "member_id" = ? AND "scope_kind" = ?`,
        )
          .bind(params.memberId, params.scopeKind)
          .all<EnvironmentGrantRow>(),
      );
      return rows.results.map(toModel);
    }),
```

> This SELECT is backed by the `idx_environment_grant_member_scope`
> `(member_id, scope_kind, scope_id)` index (prefix match on the first two
> columns). No new index needed.

### 5.3 Update the test stub

`apps/server/src/auth/scope.test.ts` stubs `EnvironmentGrantRepo` via
`provideGrantRepo` (a full port object). Add the new method so the stub still
satisfies the widened port type:

```ts
      findForMemberByScopeKind: () => Effect.succeed([]),
```

Add it inside `Effect.provideService(EnvironmentGrantRepo, { ... })` alongside the
existing `findByScope`, `upsert`, etc. (No behavioral test needed there — the file
exercises `assertPermissionOn`, which does not call this method.)

> Audit any OTHER place that constructs an `EnvironmentGrantRepository` literal
> (search `EnvironmentGrantRepo,` provideService / `Layer.succeed(EnvironmentGrantRepo`).
> As of this spec the only two are the `Live` adapter (§5.2) and `scope.test.ts`
> (§5.3). The new unit test (§11.2) provides its own stub including the method.

---

## 6. Server-side glue — `apps/server/src/handlers/env-vars-helpers.ts`

The env-var-specific ABAC glue lives HERE (not in the generic `auth/scope.ts`),
because helpers in `handlers/` may import repos + auth, while `auth/scope.ts` must
stay generic. Add the following to `env-vars-helpers.ts`.

### 6.1 New imports

Add:

```ts
import { CurrentActor } from "../auth/current-actor"; // already imported
import { buildEnvVarScopeId, ENV_VAR_SCOPE_KIND, parseEnvVarScopeId } from "../auth/scope";
import { assertPermissionOn } from "../auth/scope"; // re-export already exists; one import line ok
import { EnvironmentGrantRepo } from "../repositories/environment-grant-repo";

import type { Action } from "../models";
import type { EnvVarEnvironment } from "../models"; // already imported via existing type import block
```

> Consolidate the `../auth/scope` imports into a single `import { ... } from "../auth/scope"`
> line. `CurrentActor` and `EnvVarEnvironment` are already imported — do not
> duplicate; merge into existing import statements. Run `bun run format` after.

### 6.2 `assertEnvVarScopedPermission`

A thin wrapper that builds the scope id and delegates to the UNCHANGED
`assertPermissionOn`:

```ts
/**
 * Per (project × environment) scoped permission gate for env vars. Delegates to
 * the generic `assertPermissionOn` with scopeKind = env_var_environment and a
 * scope id built from (projectId-or-null, environment). A failed scoped check is a
 * Forbidden (403). Deny-wins / baseline / allow resolution is entirely inside
 * `assertPermissionOn` — unchanged.
 */
export const assertEnvVarScopedPermission = (
  action: Action,
  projectId: string | null,
  environment: EnvVarEnvironment,
) =>
  assertPermissionOn("envVar", action, {
    scopeKind: ENV_VAR_SCOPE_KIND,
    scopeId: buildEnvVarScopeId(projectId, environment),
  });
```

### 6.3 `resolveEnvReadPredicate`

An Effect that yields `CurrentActor` + `EnvironmentGrantRepo` ONCE and returns a
PURE predicate `(projectIdOrNull, environment) => boolean` implementing deny-wins
for the `envVar:read` token. Used by `list` (§7). API-key actors
(`ctx.memberId === null`) get baseline-only (no grant lookup).

```ts
const ENV_VAR_READ_TOKEN = "envVar:read" as const;

/**
 * Resolve the actor's per (project × environment) env-var READ access ONCE into an
 * in-memory predicate. Deny-wins, mirroring `assertPermissionOn`:
 *   - matching deny on the scope id           -> false
 *   - else role baseline allows envVar:read   -> true
 *   - else a matching allow grant on the scope -> true
 *   - else                                     -> false
 * API-key actors (no member id) skip the grant query: predicate = baseline only.
 *
 * The predicate keys on the SAME scope id the create/get/etc. asserts use, so
 * `scope=all` list rows (project rows by projectId, global rows by the sentinel)
 * filter uniformly.
 */
export const resolveEnvReadPredicate = (): Effect.Effect<
  (projectId: string | null, environment: EnvVarEnvironment) => boolean,
  never,
  CurrentActor | EnvironmentGrantRepo
> =>
  Effect.gen(function* () {
    const ctx = yield* CurrentActor;
    const baseline = ctx.effectivePermissions.envVar?.includes("read") ?? false;

    // API-key principal: no grants apply, baseline only.
    if (!ctx.memberId) {
      return () => baseline;
    }

    const repo = yield* EnvironmentGrantRepo;
    const grants = yield* repo.findForMemberByScopeKind({
      memberId: ctx.memberId,
      scopeKind: ENV_VAR_SCOPE_KIND,
    });

    // Index grants by scope id -> { denied, allowed } for envVar:read.
    const byScope = new Map<string, { denied: boolean; allowed: boolean }>();
    for (const grant of grants) {
      const slot = byScope.get(grant.scopeId) ?? { denied: false, allowed: false };
      if (grant.actions.includes(ENV_VAR_READ_TOKEN)) {
        if (grant.effect === "deny") {
          slot.denied = true;
        } else {
          slot.allowed = true;
        }
      }
      byScope.set(grant.scopeId, slot);
    }

    return (projectId, environment) => {
      const slot = byScope.get(buildEnvVarScopeId(projectId, environment));
      if (slot?.denied) {
        return false;
      }
      if (baseline) {
        return true;
      }
      return slot?.allowed ?? false;
    };
  });
```

> `parseEnvVarScopeId` is imported in this file only for use by the unit tests / if
> a future caller needs to read back a stored grant; it is exported from
> `auth/scope.ts`. If the lint `no-unused-vars` flags an unused import, drop the
> `parseEnvVarScopeId` import from `env-vars-helpers.ts` (it is exercised directly
> from `auth/scope.ts` in the scope-id unit test §11.1). Prefer importing it ONLY
> where used.

### 6.4 Functional-style note

`resolveEnvReadPredicate` uses a `for…of` + `Map` mutation to build the index. The
codebase's functional rules allow local mutation inside a builder (see
`applyOverrideResolution` using `Set`); keep the mutation local to the closure. If
`functional/no-let` or `functional/immutable-data` complains, refactor the index
build to `grants.reduce(...)` returning a fresh `Map` per step is acceptable but
verbose — prefer the local-mutation form and only refactor if lint errors. Do NOT
add an inline disable without first trying the reduce form.

---

## 7. Per-handler wiring — `apps/server/src/handlers/env-vars.ts`

Every env-var operation carries an `environment` and a project-or-global scope.
Add a scoped assert to each. Import the two helpers:

```ts
import {
  // …existing imports from "./env-vars-helpers"…
  assertEnvVarScopedPermission,
  resolveEnvReadPredicate,
} from "./env-vars-helpers";
```

Action-by-action changes (the existing `assertPermission("envVar", action)` org-wide
gate STAYS — the scoped assert is layered ON TOP):

### 7.1 `create`

After the existing `assertScopeOwnership(scope, projectId)` and BEFORE the limit
checks, add the scoped assert using the payload's scope:

```ts
yield * assertScopeOwnership(scope, projectId);
yield *
  assertEnvVarScopedPermission(
    "create",
    scope === "project" ? (projectId ?? null) : null,
    payload.environment,
  );
```

> `scope === "project"` requires `projectId` (enforced by `assertScopeOwnership`);
> when global, pass `null` so the sentinel is used.

### 7.2 `get` / `update` / `delete` / `rollback` / `revisions` — REORDER load-then-assert

These currently call `assertPermission(...)` BEFORE loading the row. **Reorder**:
keep the org-wide `assertPermission` as today (cheap pre-check is fine), then after
`repo.findById` + `assertOrgOwnership(model.organizationId)`, add the scoped assert
using `model.projectId` + `model.environment`. A failed scoped check returns 403
(Forbidden — `assertPermissionOn` already fails with `Forbidden`).

The action token per handler:

| handler     | scoped action |
| ----------- | ------------- |
| `get`       | `"read"`      |
| `revisions` | `"read"`      |
| `update`    | `"update"`    |
| `rollback`  | `"update"`    |
| `delete`    | `"delete"`    |

Pattern for `get` (apply the same shape to the others, swapping the action):

```ts
    .handle("get", ({ path }) =>
      toApiBadRequestReadEffect(
        Effect.gen(function* () {
          yield* assertPermission("envVar", "read");

          const repo = yield* EnvVarRepo;
          const model = yield* repo.findById({ id: path.id });
          yield* assertOrgOwnership(model.organizationId);

          yield* assertEnvVarScopedPermission("read", model.projectId, model.environment);

          return toApiEnvVar(model);
        }),
      ),
    )
```

For `update`: load `existing` first (already does), `assertOrgOwnership(existing.organizationId)`
(already does), THEN
`yield* assertEnvVarScopedPermission("update", existing.projectId, existing.environment);`
before branching on `payload.value` / `payload.visibility`.

For `delete`: after `assertOrgOwnership(model.organizationId)`, add
`yield* assertEnvVarScopedPermission("delete", model.projectId, model.environment);`
before `repo.deleteById`.

For `rollback`: after `assertOrgOwnership(existing.organizationId)`, add
`yield* assertEnvVarScopedPermission("update", existing.projectId, existing.environment);`
before `repo.rollback`.

For `revisions`: after `assertOrgOwnership(model.organizationId)`, add
`yield* assertEnvVarScopedPermission("read", model.projectId, model.environment);`
before `repo.listRevisions`.

> `EnvVarModel.projectId` is `string | null`, which is exactly the
> `assertEnvVarScopedPermission` first-positional contract (`projectId: string | null`).
> Pass it directly — do NOT coerce.

### 7.3 `export` — single environment, scoped assert

`export` is handled in `handleExport` (`env-vars-helpers.ts`). It already gates
`assertProjectOwnership(urlParams.projectId)` + bearer transport. Add the scoped
assert there. Export is ALWAYS project-scoped (`urlParams.projectId` is required),
so pass the project id (not null). In `handleExport`, after
`yield* assertProjectOwnership(urlParams.projectId);`:

```ts
yield * assertProjectOwnership(urlParams.projectId);
yield * assertEnvVarScopedPermission("read", urlParams.projectId, urlParams.environment);
```

> Move `assertEnvVarScopedPermission` import into `handleExport`'s file — it is the
> same file (`env-vars-helpers.ts`), so it is in scope. The function it lives in is
> in `env-vars-helpers.ts`; `assertEnvVarScopedPermission` is defined in the same
> module (§6.2), so reference it directly.
> Note: global vars merged into a project export are read-gated by the PROJECT
> scope here (export is a project-environment surface). This is intentional —
> export's unit of authorization is the project environment.

### 7.4 `bulkImport` — assert per DISTINCT (projectId, environment) pair

`bulkImport` is handled in `handleBulkImport` (`env-vars-helpers.ts`). It already
gates `assertPermission("envVar", "create")` + `assertScopeOwnership`. The payload
has a single `scope`/`projectId` for the whole batch, but per-entry
`environment`s. Add a scoped `create` assert for each DISTINCT environment in the
batch (the project segment is constant for the batch):

After `assertScopeOwnership(payload.scope, payload.projectId)` and after key
validation, BEFORE the version check:

```ts
const scopedProjectId = payload.scope === "project" ? (payload.projectId ?? null) : null;
const distinctEnvironments = [...new Set(payload.entries.map((entry) => entry.environment))];
yield *
  Effect.forEach(
    distinctEnvironments,
    (environment) => assertEnvVarScopedPermission("create", scopedProjectId, environment),
    { discard: true },
  );
```

> "DISTINCT (projectId, environment) pair" — projectId is fixed per batch, so the
> distinct pairs reduce to distinct environments. Asserting per distinct
> environment is exactly the requirement.

### 7.5 `list` — the hard one: resolve read predicate ONCE, then FILTER

`list` returns MANY environments at once, so it canNOT call the single-shot scoped
assert per row. Instead:

1. Keep the existing org-wide `assertPermission("envVar", "read")` + ownership
   checks (`assertProjectOwnership` / `assertOrgOwnership`) — unchanged.
2. Resolve the predicate ONCE: `const isReadable = yield* resolveEnvReadPredicate();`
3. Fetch rows as today via `repo.list(filters)`.
4. **FILTER fetched rows by `isReadable(model.projectId, model.environment)`** —
   drop unreadable rows SILENTLY (standard console UX) — BEFORE `applyOverrideResolution`.
5. Then run `applyOverrideResolution` (for `scope === "all"`) / mapping on the
   FILTERED set.

Concretely, replace the tail of the `list` handler (from `const { items } = yield* repo.list(filters);`):

```ts
const isReadable = yield * resolveEnvReadPredicate();

const { items } = yield * repo.list(filters);
const readable = items.filter((model) => isReadable(model.projectId, model.environment));

if (scope === "all") {
  const resolved = applyOverrideResolution(readable);
  return {
    items: resolved.map((entry) => toApiEnvVar(entry.model, entry.overridesGlobal)),
  };
}
return { items: readable.map((model) => toApiEnvVar(model)) };
```

> `resolveEnvReadPredicate` may be resolved anywhere after `CurrentActor` is
> obtained; put the `const isReadable = …` line just before `repo.list` for
> clarity.
> For `scope === "all"` the predicate filters project rows by their project
> `scope_id` and global rows by the global sentinel uniformly, because
> `model.projectId` is `null` for global rows → sentinel; non-null for project
> rows → project id. Filtering BEFORE `applyOverrideResolution` means a hidden
> global var cannot leak via an override flag, and a hidden project var cannot
> shadow a visible global. API-key actors: predicate = baseline-only, so behavior
> is unchanged from today (all-or-nothing on `envVar:read` baseline).

---

## 8. API contracts — `packages/api`

Mirror the `channel-grants` group. Templates confirmed:
`packages/api/src/groups/channel-grants.ts`, `packages/api/src/domain/channel-grant.ts`,
`packages/api/src/api.ts`, `packages/api/src/index.ts`.

### 8.1 NEW domain file — `packages/api/src/domain/env-grant.ts`

```ts
import { Schema } from "effect";

import { DateTimeString, Id } from "./common";
import { EnvVarEnvironment } from "./env-var";
import { GrantEffectSchema } from "./channel-grant";

/**
 * One member's allow/deny set on a (project × environment) env-var scope.
 * `scopeKind` is fixed to "env_var_environment". `scopeId` is the encoded
 * `<projectId|global>:<environment>` token (server-built). `actions` are
 * "resource:action" tokens (here always envVar:*).
 */
export class EnvGrant extends Schema.Class<EnvGrant>("EnvGrant")({
  id: Id,
  memberId: Id,
  scopeKind: Schema.Literal("env_var_environment"),
  scopeId: Schema.String,
  effect: GrantEffectSchema,
  actions: Schema.Array(Schema.String),
  createdAt: DateTimeString,
}) {}

/** A flattened row for the list UI: one member × environment cell. */
export class EnvGrantRow extends Schema.Class<EnvGrantRow>("EnvGrantRow")({
  memberId: Id,
  environment: EnvVarEnvironment,
  effect: GrantEffectSchema,
  actions: Schema.Array(Schema.String),
}) {}

/**
 * URL params for listing grants on a project-or-global scope. `projectId` is the
 * sentinel "global" or a real project id (the server resolves null vs the
 * sentinel). Carried as a query param.
 */
export const ListEnvGrantsParams = Schema.Struct({
  projectId: Schema.String,
});

/**
 * Upsert one (member, project-or-global, environment) grant. `projectId` null =
 * org-global vault. effect defaults to "allow". actions are envVar:* tokens.
 */
export const UpsertEnvGrantBody = Schema.Struct({
  memberId: Id,
  projectId: Schema.NullOr(Id),
  environment: EnvVarEnvironment,
  effect: Schema.optionalWith(GrantEffectSchema, { default: () => "allow" as const }),
  actions: Schema.Array(Schema.String).pipe(Schema.minItems(1)),
});

/** Delete both effects for (member, project-or-global, environment). */
export const DeleteEnvGrantBody = Schema.Struct({
  memberId: Id,
  projectId: Schema.NullOr(Id),
  environment: EnvVarEnvironment,
});

export const DeleteEnvGrantResult = Schema.Struct({ deleted: Schema.Number });
```

> `GrantEffectSchema` and `EnvVarEnvironment` are reused from the existing domain
> files (`channel-grant.ts`, `env-var.ts`) — do NOT redefine. The list returns
> `EnvGrantRow[]` per the locked design ("rows of `{ memberId, environment, effect,
actions }`"). `EnvGrant` (the full grant) is the upsert success type.

### 8.2 NEW group file — `packages/api/src/groups/env-grants.ts`

Endpoints are POST-bodied for upsert/delete (the scope id is server-derived from
`{ projectId, environment }` in the body, not URL path segments — a colon-encoded
scope id in a path is brittle). Use query for list.

```ts
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import {
  DeleteEnvGrantBody,
  DeleteEnvGrantResult,
  EnvGrant,
  EnvGrantRow,
  ListEnvGrantsParams,
  UpsertEnvGrantBody,
} from "../domain/env-grant";
import { BadRequest } from "../domain/errors";

export class EnvGrantsGroup extends HttpApiGroup.make("envGrants")
  .add(
    HttpApiEndpoint.get("list", "/api/env-grants")
      .setUrlParams(ListEnvGrantsParams)
      .addSuccess(Schema.Array(EnvGrantRow))
      .annotateContext(
        OpenApi.annotations({
          title: "List env-var environment grants",
          description:
            "List per-member allow/deny env-var grants on a project-or-global scope across all environments. projectId is a real id or the sentinel 'global'.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.put("upsert", "/api/env-grants")
      .setPayload(UpsertEnvGrantBody)
      .addSuccess(EnvGrant)
      .annotateContext(
        OpenApi.annotations({
          title: "Upsert env-var environment grant",
          description:
            "Create or replace a member's allow/deny env-var grant on one (project-or-global × environment) scope. projectId null = org-global.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("delete", "/api/env-grants")
      .setPayload(DeleteEnvGrantBody)
      .addSuccess(DeleteEnvGrantResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Delete env-var environment grants",
          description:
            "Revoke both allow and deny grants for a member on one (project-or-global × environment) scope.",
        }),
      ),
  )
  .addError(NotFound)
  .addError(Forbidden)
  .addError(BadRequest)
  .annotateContext(
    OpenApi.annotations({
      title: "Env-var environment grants",
      description:
        "Per (project × environment) ABAC permission grants for env vars (allow/deny by member)",
    }),
  ) {}
```

> `HttpApiEndpoint.del` with a `setPayload` body: confirm the platform version
> supports a body on DELETE (it does — `del(...).setPayload(...)` is valid in
> `@effect/platform`). If a constraint surfaces, fall back to encoding
> member/project/environment as query params on a `del` with `.setUrlParams`; but
> prefer the body form for parity with `upsert`.

### 8.3 Register the group — `packages/api/src/api.ts`

In the `import` block (alphabetical-ish, grouped with the other groups), add:

```ts
import { EnvGrantsGroup } from "./groups/env-grants";
```

In the `ManagementApi` builder chain, add `.add(EnvGrantsGroup)` right AFTER
`.add(ChannelGrantsGroup)` (keep grant groups adjacent):

```ts
  .add(ChannelGrantsGroup)
  .add(EnvGrantsGroup)
```

### 8.4 Re-export — `packages/api/src/index.ts`

Add domain exports near the `channel-grant` block:

```ts
export {
  DeleteEnvGrantBody,
  DeleteEnvGrantResult,
  EnvGrant,
  EnvGrantRow,
  ListEnvGrantsParams,
  UpsertEnvGrantBody,
} from "./domain/env-grant";
```

Add the group export near `ChannelGrantsGroup`:

```ts
export { EnvGrantsGroup } from "./groups/env-grants";
```

---

## 9. Management handler — NEW `apps/server/src/handlers/env-grants.ts`

`HttpApiBuilder.group` for the `envGrants` group. Encode `scope_id` via the shared
`buildEnvVarScopeId` helper, reuse EXISTING `EnvironmentGrantRepo` methods
`upsert` / `findByScope` / `deleteForMemberOnScope` with
`scopeKind = ENV_VAR_SCOPE_KIND`. Gate management with `assertPermission("member", "update")`
(owner/admin only — mirrors `channel-grants.ts`, where managing who can act is a
membership-admin action). Audit-log each mutation.

```ts
import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import type {
  EnvGrant as EnvGrantSchema,
  EnvGrantRow as EnvGrantRowSchema,
} from "@better-update/api";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { statement } from "../auth/access-control";
import { CurrentActor } from "../auth/current-actor";
import { assertProjectOwnership } from "../auth/ownership";
import { assertPermission } from "../auth/permissions";
import {
  buildEnvVarScopeId,
  ENV_VAR_GLOBAL_SENTINEL,
  ENV_VAR_SCOPE_KIND,
  parseEnvVarScopeId,
} from "../auth/scope";
import { Forbidden, NotFound } from "../errors";
import { toApiReadEffect } from "../http/to-api-effect";
import { EnvironmentGrantRepo } from "../repositories/environment-grant-repo";
import { MemberRepo } from "../repositories/org-role-repo";

import type { EnvironmentGrantModel } from "../authz-models";
import type { EnvVarEnvironment } from "../models";

const VALID_RESOURCES = new Set(Object.keys(statement));
const ACTION_TOKEN = /^[a-z]+:[a-z]+$/iu;

const toApiEnvGrant = (grant: EnvironmentGrantModel): typeof EnvGrantSchema.Type => ({
  id: grant.id,
  memberId: grant.memberId,
  scopeKind: grant.scopeKind,
  scopeId: grant.scopeId,
  effect: grant.effect,
  actions: [...grant.actions],
  createdAt: grant.createdAt,
});

// Reject free-form action tokens (mirror channel-grants). Surfaced as Forbidden.
const assertValidActionTokens = (actions: readonly string[]) =>
  Effect.gen(function* () {
    const invalid = actions.filter((token) => {
      if (!ACTION_TOKEN.test(token)) {
        return true;
      }
      const [resource] = token.split(":");
      return resource === undefined || !VALID_RESOURCES.has(resource);
    });
    if (invalid.length > 0) {
      yield* new Forbidden({
        message: `Invalid grant action(s): ${invalid.join(", ")}. Expected "resource:action" with a known resource.`,
      });
    }
  });

// Resolve the project-or-global scope + gate management (member:update). For a
// project scope, tenant-check project ownership; for global, the org-wide
// member:update gate suffices.
const gateScope = (projectId: string | null) =>
  Effect.gen(function* () {
    if (projectId !== null) {
      yield* assertProjectOwnership(projectId);
    }
    yield* assertPermission("member", "update");
  });

// Resolve the request's project segment: a body/query `projectId` that is the
// sentinel "global" (or null) means the org-global vault → null; else a real id.
const resolveProjectId = (raw: string | null): string | null =>
  raw === null || raw === ENV_VAR_GLOBAL_SENTINEL ? null : raw;

export const EnvGrantsGroupLive = HttpApiBuilder.group(ManagementApi, "envGrants", (handlers) =>
  handlers
    .handle("list", ({ urlParams }) =>
      toApiReadEffect(
        Effect.gen(function* () {
          const projectId = resolveProjectId(urlParams.projectId);
          yield* gateScope(projectId);

          const grantRepo = yield* EnvironmentGrantRepo;

          // One read per environment scope id (3 environments). D1 caps a compound
          // SELECT at 5 UNION terms, so 3 separate findByScope calls are simplest.
          const environments: readonly EnvVarEnvironment[] = [
            "development",
            "preview",
            "production",
          ];
          const perEnv = yield* Effect.forEach(environments, (environment) =>
            Effect.map(
              grantRepo.findByScope({
                scopeKind: ENV_VAR_SCOPE_KIND,
                scopeId: buildEnvVarScopeId(projectId, environment),
              }),
              (grants) =>
                grants.map((grant) => ({
                  memberId: grant.memberId,
                  environment,
                  effect: grant.effect,
                  actions: [...grant.actions],
                })),
            ),
          );
          return perEnv.flat() satisfies (typeof EnvGrantRowSchema.Type)[];
        }),
      ),
    )
    .handle("upsert", ({ payload }) =>
      toApiReadEffect(
        Effect.gen(function* () {
          const projectId = resolveProjectId(payload.projectId);
          yield* gateScope(projectId);
          const ctx = yield* CurrentActor;

          // Grant target must be a member of the acting org (anti-enumeration).
          const memberRepo = yield* MemberRepo;
          const memberOrgId = yield* memberRepo.findOrgId({ memberId: payload.memberId });
          if (memberOrgId !== ctx.organizationId) {
            return yield* new NotFound({ message: "Member not found" });
          }

          yield* assertValidActionTokens(payload.actions);

          const grantRepo = yield* EnvironmentGrantRepo;
          const grant = yield* grantRepo.upsert({
            organizationId: ctx.organizationId,
            memberId: payload.memberId,
            scopeKind: ENV_VAR_SCOPE_KIND,
            scopeId: buildEnvVarScopeId(projectId, payload.environment),
            effect: payload.effect,
            actions: payload.actions,
          });

          yield* logAudit({
            action: "envVar.grant.set",
            resourceType: "envVar",
            resourceId: grant.id,
            ...(projectId ? { projectId } : {}),
            metadata: {
              memberId: payload.memberId,
              environment: payload.environment,
              scope: projectId ?? ENV_VAR_GLOBAL_SENTINEL,
              effect: payload.effect,
              actions: [...payload.actions],
            },
          });

          return toApiEnvGrant(grant);
        }),
      ),
    )
    .handle("delete", ({ payload }) =>
      toApiReadEffect(
        Effect.gen(function* () {
          const projectId = resolveProjectId(payload.projectId);
          yield* gateScope(projectId);

          const grantRepo = yield* EnvironmentGrantRepo;
          yield* grantRepo.deleteForMemberOnScope({
            memberId: payload.memberId,
            scopeKind: ENV_VAR_SCOPE_KIND,
            scopeId: buildEnvVarScopeId(projectId, payload.environment),
          });

          yield* logAudit({
            action: "envVar.grant.revoke",
            resourceType: "envVar",
            resourceId: buildEnvVarScopeId(projectId, payload.environment),
            ...(projectId ? { projectId } : {}),
            metadata: {
              memberId: payload.memberId,
              environment: payload.environment,
              scope: projectId ?? ENV_VAR_GLOBAL_SENTINEL,
            },
          });

          return { deleted: 1 };
        }),
      ),
    ),
);
```

> Notes:
>
> - `parseEnvVarScopeId` import is listed for symmetry; if unused after final code,
>   drop it (lint will flag). Only import what you reference.
> - `logAudit` `resourceType` must be a valid `AuditLogResourceType`. Confirm
>   `"envVar"` is in that union (it is the resource type env-vars.ts already uses,
>   e.g. `resourceType: "envVar"`). The audit `action` strings `"envVar.grant.set"`
>   / `"envVar.grant.revoke"` mirror channel's `"channel.grant.set"` /
>   `"channel.grant.revoke"`. If the audit `action` field is a constrained enum,
>   check `apps/server/src/audit/` for the allowed set and add these two — mirror
>   exactly how channel grant actions were added there.
> - `MemberRepo.findOrgId` is the same method `channel-grants.ts` uses.
> - The `EnvGrantRow` mapping returns `{ memberId, environment, effect, actions }`
>   exactly per the contract.

### 9.1 Register the handler — `apps/server/src/handlers/index.ts`

Add near `ChannelGrantsGroupLive`:

```ts
export { EnvGrantsGroupLive } from "./env-grants";
```

### 9.2 Register in `apps/server/src/app-layer.ts`

Add `EnvGrantsGroupLive` to BOTH the import-from-handlers list (line ~22 block) AND
the layer-merge list (line ~59 block), adjacent to `ChannelGrantsGroupLive`:

- In the named import from `./handlers`, add `EnvGrantsGroupLive,`.
- In the `Layer.mergeAll(...)` (or equivalent) composition, add
  `EnvGrantsGroupLive,`.

> The repo `EnvironmentGrantRepoLive` is ALREADY wired in
> `apps/server/src/infrastructure-layer.ts` (confirmed: imported line 43, in the
> `Layer` merge line 154, and in the `RequirementsLayer` union line 117). No extra
> infrastructure wiring is needed for the new repo method — it lives on the same
> `Live` object.

---

## 10. Web — `apps/web` Environment access settings page

A new "Environment access" page under org settings with a PROJECT SELECTOR
(including a "Global" entry) rendering a member × `{development, preview, production}`
matrix. Each cell controls that member's grant on `(selectedProject-or-global, environment)`:
**Inherit (no grant) / Allow / Deny**, calling the env-grants endpoints.

### 10.1 Queries — `apps/web/src/queries/org.ts`

Add an "Env grants" section after the "Channel grants" block. The list query keys
on the selected `projectScope` token (a real project id OR the sentinel `"global"`).

```ts
import type {
  // …existing…
  DeleteEnvGrantBody,
  DeleteEnvGrantResult,
  UpsertEnvGrantBody,
} from "@better-update/api";

// ── Env-var environment grants ──────────────────────────────────────────────

/** Sentinel project token for the org-global env-var scope (mirrors server). */
export const ENV_GRANT_GLOBAL = "global" as const;

export const envGrantsQueryKey = (projectScope: string) => ["env-grants", projectScope] as const;

export const envGrantsQueryOptions = (projectScope: string) =>
  queryOptions({
    queryKey: envGrantsQueryKey(projectScope),
    queryFn: async ({ signal }) =>
      runApi((api) => api.envGrants.list({ urlParams: { projectId: projectScope } }), signal),
    staleTime: 30_000,
  });

export const upsertEnvGrant = async (body: typeof UpsertEnvGrantBody.Type) =>
  runApi((api) => api.envGrants.upsert({ payload: body }));

export const deleteEnvGrant = async (
  body: typeof DeleteEnvGrantBody.Type,
): Promise<typeof DeleteEnvGrantResult.Type> =>
  runApi((api) => api.envGrants.delete({ payload: body }));
```

> The list response is `EnvGrantRow[]` (`{ memberId, environment, effect, actions }`).
> `projectScope === ENV_GRANT_GLOBAL` requests the global scope; a real project id
> requests that project. The web sends `projectId: ENV_GRANT_GLOBAL` for global —
> the server's `resolveProjectId` maps the sentinel back to `null`.

### 10.2 Nav entry — `apps/web/src/components/settings-layout.tsx`

Add an entry to `ORG_SETTINGS_NAV`:

```ts
import { KeyRoundIcon, SettingsIcon, ShieldIcon } from "lucide-react";

export const ORG_SETTINGS_NAV: readonly SettingsNavSection[] = [
  {
    items: [
      { to: "/settings", label: "General", icon: SettingsIcon },
      { to: "/settings/roles", label: "Roles", icon: ShieldIcon },
      { to: "/settings/env-access", label: "Environment access", icon: KeyRoundIcon },
    ],
  },
];
```

> `ORG_SETTINGS_NAV` is rendered by whichever route lays out `/settings` (mirror
> `account.tsx`'s `SettingsLayout` usage). Confirm the `/settings` layout route
> consumes `ORG_SETTINGS_NAV`; if `/settings` does NOT yet have a layout route that
> renders `SettingsLayout` with `ORG_SETTINGS_NAV`, the new page mirrors
> `roles.tsx` (a standalone settings route that renders its own `PageHeader`), and
> the nav link still resolves. Do NOT invent a new layout route — match the exact
> structure `roles.tsx` uses (standalone route, `validateSearch`, `PageHeader`).

### 10.3 Page route — NEW `apps/web/src/routes/_authed/_app/settings/env-access.tsx`

Mirror `roles.tsx` structure: a `createFileRoute("/_authed/_app/settings/env-access")`
with `validateSearch` (zod) carrying the selected project token + sort, a `Suspense`
content component, a `PageHeader`. The selected project lives in router search
state (NOT `useState`) per house rules.

Search schema:

```ts
const envAccessSearchSchema = z.object({
  // selected project scope: a project id OR "global" (default).
  project: z.string().default("global"),
});
```

Content:

- `const orgId = activeOrg.id;` from route context.
- `const { data: projects } = useSuspenseQuery(projectsQueryOptions(orgId, { limit: 100 }));`
  (import `projectsQueryOptions` from `@better-update/api-client/react`, as
  `-project-switcher.tsx` does).
- `const { data: members } = useSuspenseQuery(membersQueryOptions(orgId));`
- `const { project } = Route.useSearch();` and `const navigate = Route.useNavigate();`
- `const { data: grants } = useSuspenseQuery(envGrantsQueryOptions(project));`
- Render a PROJECT SELECTOR (coss `Select`) whose options are `Global` (value
  `ENV_GRANT_GLOBAL`) plus each project (value = project id, label = project name).
  On change, `navigate({ search: (prev) => ({ ...prev, project: value }) })`.
- Render the matrix `EnvAccessMatrix` (extract into a sibling file — see §10.4) to
  keep JSX depth ≤ 9.

Route export:

```ts
export const Route = createFileRoute("/_authed/_app/settings/env-access")({
  validateSearch: zodValidator(envAccessSearchSchema),
  component: EnvAccessPage,
});
```

### 10.4 Matrix component — NEW `apps/web/src/routes/_authed/_app/settings/-env-access-matrix.tsx`

Props: `{ projectScope: string; members: readonly MemberItem[]; grants: readonly EnvGrantRow[] }`.

- Build a lookup `cellEffect(memberId, environment): "allow" | "deny" | undefined`
  from `grants` (a grant row's `effect` for that member+environment; `undefined` =
  Inherit). Note both allow + deny rows can exist for a scope; the cell control is
  TRI-STATE — Inherit / Allow / Deny — and choosing Allow upserts an allow grant
  with `actions: ["envVar:read"]` (and the standard read+write set, see below),
  choosing Deny upserts a deny grant, choosing Inherit deletes BOTH effects on that
  scope.
- Each row = one member. Columns = `development`, `preview`, `production`. Each cell
  is a small coss `Select` (or a 3-segment control) with options Inherit / Allow /
  Deny.
- On cell change call the mutation:
  - **Allow** → `upsertEnvGrant({ memberId, projectId, environment, effect: "allow", actions: ENV_VAR_GRANT_ACTIONS })`
  - **Deny** → `upsertEnvGrant({ memberId, projectId, environment, effect: "deny", actions: ["envVar:read"] })`
    (a deny on read is the meaningful subtraction; for a coarse cell, deny the read
    token — denying read blocks listing/getting; the matrix is a read-access matrix
    primarily).
  - **Inherit** → `deleteEnvGrant({ memberId, projectId, environment })`
  - where `projectId = projectScope === ENV_GRANT_GLOBAL ? null : projectScope`.
- Define `const ENV_VAR_GRANT_ACTIONS = ["envVar:read"] as const;` at module scope.
  (The matrix governs READ access — the locked design's e2e is read-centric. If
  later extended to write cells, widen this set; for v1 keep it read-focused.)
- Use `useApiMutation` + `useQueryClient`, invalidate `envGrantsQueryKey(projectScope)`
  on success, toast on success (`toastManager.add`). Track in-flight per cell via
  the mutation `variables` (NOT a `useState<Set>`), per house rules
  (`feedback_auth_client_mutation`).
- Member label: `member.user.name || member.user.email || member.id` (mirror
  `-grants-table.tsx`).
- Keep JSX depth ≤ 9: extract the per-cell `Select` into a `MatrixCell` subcomponent
  in the same file if the row JSX approaches the cap.
- Use coss `Select` (canonical names — `Select`, `SelectTrigger`, `SelectPopup`,
  `SelectItem` etc. per the coss skill), `Spinner` / `Button loading` for pending,
  `Empty` when no members.

> This page is a MATRIX, not a paginated `DataTableView` list, so the
> `lib/data-table` mandate does not apply here (there is no server pagination of
> cells). If you instead render members as a sortable table with environment
> columns, you MUST use `DataTableView` + `useDataTableSearch` (mirror
> `-grants-table.tsx`). Either approach is acceptable; the matrix-of-Selects is
> simpler and recommended. Pick ONE and keep it consistent.

> Web verification: do NOT run e2e. Verify via `bun run lint` and (if added) web
> unit tests. The verify phase runs lint + server unit only.

---

## 11. CLI — `apps/cli` env grants commands

Add an `env grants` subcommand group (list / set / unset) under the `env` command.
Templates: `apps/cli/src/commands/channels/grants/` and `apps/cli/src/commands/env/`.

### 11.1 NEW dir `apps/cli/src/commands/env/grants/`

Files: `index.ts`, `list.ts`, `set.ts`, `unset.ts`, `helpers.ts`.

**`helpers.ts`** (mirror channels/grants/helpers.ts):

```ts
import { Data } from "effect";

export class EnvGrantCommandError extends Data.TaggedError("EnvGrantCommandError")<{
  readonly message: string;
}> {}

export const envGrantErrorExtras = { EnvGrantCommandError: 2 } as const;

/** Sentinel project token for the org-global env-var scope (mirrors server). */
export const ENV_GRANT_GLOBAL = "global" as const;
```

**`index.ts`**:

```ts
import { defineCommand } from "citty";

import { listCommand } from "./list";
import { setCommand } from "./set";
import { unsetCommand } from "./unset";

export const grantsCommand = defineCommand({
  meta: {
    name: "grants",
    description: "Manage per-member env-var access grants on a (project × environment) scope",
  },
  subCommands: {
    list: listCommand,
    set: setCommand,
    unset: unsetCommand,
  },
});
```

**`list.ts`** — args: optional `--project` (id or "global"; default resolves to the
linked project via `readProjectId`, or pass `global` for the org scope). Calls
`api.envGrants.list({ urlParams: { projectId } })` and `printList` over the rows
`[memberId, environment, effect, actions.join(", ")]`.

```ts
import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../../lib/citty-effect";
import { printList } from "../../../lib/output";
import { readProjectId } from "../../../lib/project-link";
import { apiClient } from "../../../services/api-client";
import { ENV_GRANT_GLOBAL, envGrantErrorExtras } from "./helpers";

export const listCommand = defineCommand({
  meta: { name: "list", description: "List env-var grants on a (project × environment) scope" },
  args: {
    project: {
      type: "string",
      description: `Project id, or "${ENV_GRANT_GLOBAL}" for the org-global scope (default: linked project)`,
    },
    global: {
      type: "boolean",
      default: false,
      description: "Target the org-global env-var scope instead of a project",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const projectId = args.global ? ENV_GRANT_GLOBAL : (args.project ?? (yield* readProjectId));
        const api = yield* apiClient;

        const rows = yield* api.envGrants.list({ urlParams: { projectId } });

        yield* printList(
          ["Member ID", "Environment", "Effect", "Actions"],
          rows.map((row) => [row.memberId, row.environment, row.effect, row.actions.join(", ")]),
          "No env-var grants found for this scope.",
        );
      }),
      { exits: { ...envGrantErrorExtras } },
    ),
});
```

**`set.ts`** — args: `--member` (required), `--environment` (required, validated
against development/preview/production), `--actions` (CSV, default
`envVar:read`), `--effect` (allow|deny, default allow), `--project` / `--global`.
Maps to `api.envGrants.upsert({ payload: { memberId, projectId, environment, effect, actions } })`
where `projectId = global ? null : resolvedId`. NOTE: the API body `projectId` is
`NullOr(Id)` — send `null` for global (not the sentinel string) since the body
schema is `NullOr(Id)`, and the server treats `null` as global. (The list URL param
uses the sentinel string; the upsert/delete BODY uses `null`. Keep this asymmetry —
it matches §8.1 schemas.)

```ts
import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../../lib/citty-effect";
import { printHumanKeyValue } from "../../../lib/output";
import { readProjectId } from "../../../lib/project-link";
import { apiClient } from "../../../services/api-client";
import { ENV_GRANT_GLOBAL, EnvGrantCommandError, envGrantErrorExtras } from "./helpers";

const ENVIRONMENTS = ["development", "preview", "production"] as const;

export const setCommand = defineCommand({
  meta: { name: "set", description: "Create or replace a member's env-var grant on a scope" },
  args: {
    member: { type: "string", required: true, description: "Member ID to grant" },
    environment: {
      type: "string",
      required: true,
      description: "Environment: development | preview | production",
    },
    actions: {
      type: "string",
      description: "Comma-separated envVar:* tokens (default: envVar:read)",
    },
    effect: { type: "string", description: "allow (default) or deny" },
    project: { type: "string", description: `Project id (default: linked project)` },
    global: {
      type: "boolean",
      default: false,
      description: "Target the org-global env-var scope",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const effectValue = args.effect ?? "allow";
        if (effectValue !== "allow" && effectValue !== "deny") {
          return yield* Effect.fail(
            new EnvGrantCommandError({ message: `Invalid effect "${effectValue}".` }),
          );
        }
        if (!ENVIRONMENTS.includes(args.environment as (typeof ENVIRONMENTS)[number])) {
          return yield* Effect.fail(
            new EnvGrantCommandError({
              message: `Invalid environment "${args.environment}". One of: ${ENVIRONMENTS.join(", ")}.`,
            }),
          );
        }
        const actionTokens = (args.actions ?? "envVar:read")
          .split(",")
          .map((tok) => tok.trim())
          .filter((tok) => tok.length > 0);
        if (actionTokens.length === 0) {
          return yield* Effect.fail(
            new EnvGrantCommandError({ message: "At least one action token is required." }),
          );
        }

        const projectId = args.global ? null : (args.project ?? (yield* readProjectId));
        const api = yield* apiClient;

        const grant = yield* api.envGrants.upsert({
          payload: {
            memberId: args.member,
            projectId,
            environment: args.environment as (typeof ENVIRONMENTS)[number],
            effect: effectValue,
            actions: actionTokens,
          },
        });

        yield* printHumanKeyValue([
          ["ID", grant.id],
          ["Member ID", grant.memberId],
          ["Scope", grant.scopeId],
          ["Effect", grant.effect],
          ["Actions", grant.actions.join(", ")],
          ["Created", grant.createdAt],
        ]);
        return grant;
      }),
      { exits: { ...envGrantErrorExtras } },
    ),
});
```

**`unset.ts`** — args: `--member` (required), `--environment` (required),
`--project` / `--global`, `--yes` (skip confirm). Calls
`api.envGrants.delete({ payload: { memberId, projectId, environment } })`.

```ts
import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../../lib/citty-effect";
import { printHuman } from "../../../lib/output";
import { readProjectId } from "../../../lib/project-link";
import { promptConfirm } from "../../../lib/prompts";
import { apiClient } from "../../../services/api-client";
import { ENV_GRANT_GLOBAL, EnvGrantCommandError, envGrantErrorExtras } from "./helpers";

const ENVIRONMENTS = ["development", "preview", "production"] as const;

export const unsetCommand = defineCommand({
  meta: { name: "unset", description: "Revoke a member's env-var grants on a scope" },
  args: {
    member: { type: "string", required: true, description: "Member ID whose grants to revoke" },
    environment: { type: "string", required: true, description: "Environment" },
    project: { type: "string", description: "Project id (default: linked project)" },
    global: { type: "boolean", default: false, description: "Target the org-global scope" },
    yes: { type: "boolean", default: false, description: "Skip confirmation prompt" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        if (!ENVIRONMENTS.includes(args.environment as (typeof ENVIRONMENTS)[number])) {
          return yield* Effect.fail(
            new EnvGrantCommandError({ message: `Invalid environment "${args.environment}".` }),
          );
        }
        if (!args.yes) {
          const scopeLabel = args.global ? ENV_GRANT_GLOBAL : (args.project ?? "linked project");
          const confirmed = yield* promptConfirm(
            `Revoke env-var grants for member ${args.member} on ${scopeLabel}/${args.environment}?`,
            { initialValue: false },
          );
          if (!confirmed) {
            yield* printHuman("Cancelled.");
            return { deleted: 0 };
          }
        }

        const projectId = args.global ? null : (args.project ?? (yield* readProjectId));
        const api = yield* apiClient;

        const result = yield* api.envGrants.delete({
          payload: {
            memberId: args.member,
            projectId,
            environment: args.environment as (typeof ENVIRONMENTS)[number],
          },
        });

        yield* printHuman(`Revoked env-var grants for member ${args.member}.`);
        return result;
      }),
      { exits: { ...envGrantErrorExtras }, json: "value" },
    ),
});
```

> CLI house rule: `--global` and `--yes` are POSITIVE booleans with `default: false`
> — citty `--no-global` would negate. Never declare a `no-*` flag.

### 11.2 Register — `apps/cli/src/commands/env/index.ts`

Add `import { grantsCommand } from "./grants";` and add `grants: grantsCommand,` to
the `subCommands` object.

> `command-registry.ts` already registers `env: envCommand` (line 57). Nesting
> `grants` under `env` requires NO change to `command-registry.ts`. (The task
> mentions registering in `command-registry.ts`; confirm no edit is needed there
> because the parent `env` command is already registered — only the `env/index.ts`
> `subCommands` edit is required.)

---

## 12. Tests

### 12.1 Unit — scope id build/parse — `apps/server/src/auth/scope-id.test.ts` (NEW)

Colocated. Tests `buildEnvVarScopeId` + `parseEnvVarScopeId` + sentinel:

- `buildEnvVarScopeId("proj-1", "production")` === `"proj-1:production"`.
- `buildEnvVarScopeId(null, "development")` === `"global:development"` (uses
  `ENV_VAR_GLOBAL_SENTINEL`).
- round-trip: `parseEnvVarScopeId(buildEnvVarScopeId("proj-1", "preview"))` ===
  `{ project: "proj-1", environment: "preview" }`.
- round-trip global: `parseEnvVarScopeId(buildEnvVarScopeId(null, "production"))`
  === `{ project: "global", environment: "production" }`.
- `ENV_VAR_GLOBAL_SENTINEL === "global"` and `ENV_VAR_SCOPE_KIND === "env_var_environment"`.

Use vitest globals (`describe`/`test`/`expect`), no import from `vitest`. Pure
functions → plain `test`, no `it.effect` needed.

### 12.2 Unit — `resolveEnvReadPredicate` deny-wins — `apps/server/src/handlers/env-vars-helpers.test.ts` (NEW or extend)

`@effect/vitest` (`it.effect`) + `Effect.provideService`. Provide a stubbed
`CurrentActor` (via `AuthContext` — mirror `scope.test.ts`'s `provideActor`) and a
stubbed `EnvironmentGrantRepo` whose `findForMemberByScopeKind` returns canned
grants. Assert the returned predicate across `project × env` and the global
sentinel + api-key path:

Rows to cover (token = `envVar:read`):

1. **Baseline allows, no grants** → predicate true for any (project, env).
2. **Baseline allows, deny grant on (projA, production)** → false for
   (projA, production), true for (projA, development) and (projB, production).
3. **Baseline denies, allow grant on (projA, development)** → true for
   (projA, development), false elsewhere.
4. **Global sentinel: deny grant on (null, production)** → predicate
   `(null, "production")` false; `(null, "development")` follows baseline.
5. **Deny beats allow on the SAME scope** (both rows present) → false.
6. **API-key actor (`memberId: null`)**: predicate === baseline for ALL scopes;
   `findForMemberByScopeKind` is NEVER called (assert via an `onLookup` counter
   like `scope.test.ts`).

Stub the repo with ALL port methods present (including the new
`findForMemberByScopeKind`) so the literal satisfies `EnvironmentGrantRepository`.

> Do NOT unit-test `assertPermissionOn` again (covered by `scope.test.ts`) and do
> NOT test framework built-ins. The new repo method's SQL is covered by e2e.

### 12.3 Update stub — `apps/server/src/auth/scope.test.ts`

Per §5.3, add `findForMemberByScopeKind: () => Effect.succeed([]),` to the
`provideGrantRepo` stub object.

### 12.4 e2e — NEW `apps/server/tests/e2e/env-grants-flow.test.ts`

Mirror `channel-grants-flow.test.ts` structure (owner bootstrap +
`onboardMember` helper + member rows). Keep UNDER 120 authed reqs/file. Scenario:

1. Owner signs up, creates org + project (`env-grants-project`), grabs `projectId`.
2. Owner creates env vars via the CLI-shaped create flow? — No: e2e here drives the
   HTTP API directly. Owner creates env vars in `development`, `preview`,
   `production` for the project so there is data to list. (Use POST
   `/api/env-vars` with a sealed value envelope. Reuse the env-vars-flow.test.ts
   seal/envelope helper — confirm its shape in `env-vars-flow.test.ts` and copy the
   minimal envelope it uses; the value is opaque to the server.)
3. Invite Member A (viewer or developer with `envVar:read` baseline — use
   **admin** or **developer** so baseline read is present; per
   `project_org_roles_assignable`, set role via D1 `member.role` UPDATE if a
   non-better-auth role is needed). Invite Member B similarly.
4. Member A can `GET /api/env-vars` (list) and see dev + preview + production rows;
   can `GET /api/env-vars/:id` for a production var (200).
5. Owner `PUT /api/env-grants` body
   `{ memberId: A, projectId, environment: "production", effect: "deny", actions: ["envVar:read"] }`.
6. Member A list now OMITS the production row (filtered silently) but still shows
   dev + preview; `GET /api/env-vars/:productionId` → **403**.
7. Member B is UNAFFECTED — list still shows production; get production → 200.
8. Owner `DELETE /api/env-grants` body
   `{ memberId: A, projectId, environment: "production" }` → `{ deleted: 1 }`.
   Member A production access restored (list shows it again; get → 200).
9. API-key actor (create `/api/auth/api-key/create`): with a standing deny grant on
   Member A re-applied, the API key's list/get of production is UNAFFECTED (grants
   ignored; baseline only) → production row present, get → 200.
10. Management gating: a viewer (no `member:update`) `PUT /api/env-grants` → 403.
11. Anti-enumeration: `PUT /api/env-grants` with a random non-member id → 404.

Count authed requests carefully; if the journey nears 120, split api-key-heavy
sections per `project_cli_e2e_apikey_ratelimit` guidance (1 api key/file; the
file-level limit is 120 req/60s).

> **DO NOT RUN e2e** (too slow) — only author it. The verify phase runs lint +
> server unit only (`feedback_e2e_long_running`).

---

## 13. Verification (what the implementer runs)

1. `bun run lint` (repo root) — covers lint + typecheck across all packages.
2. `bun run test` (server unit + coverage) — runs the new unit tests in §12.1–12.3.
3. `bun run format` — oxfmt.

Do NOT run server e2e. Do NOT commit. Leave the tree dirty.

---

## 14. File-by-file checklist (ordered)

**Server core (do first — everything depends on these):**

1. EDIT `apps/server/src/authz-models.ts` — widen `ScopeKind` (§3).
2. EDIT `apps/server/src/auth/scope.ts` — add sentinel + `ENV_VAR_SCOPE_KIND` +
   `buildEnvVarScopeId` + `parseEnvVarScopeId` (§2.1). Do NOT touch
   `assertPermissionOn`.
3. CREATE `apps/server/migrations/0056_env_var_environment_grant.sql` (§4).
4. EDIT `apps/server/src/repositories/environment-grant-repo.ts` — add
   `findForMemberByScopeKind` to port + Live (§5).

**API contracts (the handler imports these):**

5. CREATE `packages/api/src/domain/env-grant.ts` (§8.1).
6. CREATE `packages/api/src/groups/env-grants.ts` (§8.2).
7. EDIT `packages/api/src/api.ts` — register `EnvGrantsGroup` (§8.3).
8. EDIT `packages/api/src/index.ts` — re-export domain + group (§8.4).

**Server handlers + glue:**

9. EDIT `apps/server/src/handlers/env-vars-helpers.ts` — add
   `assertEnvVarScopedPermission` + `resolveEnvReadPredicate`; wire `export` +
   `bulkImport` scoped asserts (§6, §7.3, §7.4).
10. EDIT `apps/server/src/handlers/env-vars.ts` — wire scoped asserts into
    create/get/update/delete/rollback/revisions/list (§7.1, §7.2, §7.5).
11. CREATE `apps/server/src/handlers/env-grants.ts` (§9).
12. EDIT `apps/server/src/handlers/index.ts` — export `EnvGrantsGroupLive` (§9.1).
13. EDIT `apps/server/src/app-layer.ts` — register `EnvGrantsGroupLive` (§9.2).

**Web:**

14. EDIT `apps/web/src/queries/org.ts` — env-grant queries (§10.1).
15. EDIT `apps/web/src/components/settings-layout.tsx` — nav entry (§10.2).
16. CREATE `apps/web/src/routes/_authed/_app/settings/env-access.tsx` (§10.3).
17. CREATE `apps/web/src/routes/_authed/_app/settings/-env-access-matrix.tsx` (§10.4).

**CLI:**

18. CREATE `apps/cli/src/commands/env/grants/helpers.ts` (§11.1).
19. CREATE `apps/cli/src/commands/env/grants/index.ts` (§11.1).
20. CREATE `apps/cli/src/commands/env/grants/list.ts` (§11.1).
21. CREATE `apps/cli/src/commands/env/grants/set.ts` (§11.1).
22. CREATE `apps/cli/src/commands/env/grants/unset.ts` (§11.1).
23. EDIT `apps/cli/src/commands/env/index.ts` — register `grants` subcommand (§11.2).

**Tests:**

24. CREATE `apps/server/src/auth/scope-id.test.ts` (§12.1).
25. CREATE `apps/server/src/handlers/env-vars-helpers.test.ts` (§12.2).
26. EDIT `apps/server/src/auth/scope.test.ts` — stub gains
    `findForMemberByScopeKind` (§12.3, §5.3).
27. CREATE `apps/server/tests/e2e/env-grants-flow.test.ts` (§12.4 — author only,
    do NOT run).

---

## 15. Open confirmations the implementer must verify in code (cheap checks)

- `logAudit` `action` field: confirm whether it is a free string or a constrained
  enum. If constrained, add `"envVar.grant.set"` / `"envVar.grant.revoke"` where
  channel grant actions live (`apps/server/src/audit/`). Mirror exactly.
- `HttpApiEndpoint.del(...).setPayload(...)` body support in the installed
  `@effect/platform`. If unsupported, switch `delete` to `.setUrlParams` with
  `{ memberId, projectId, environment }` query params (and update the handler +
  api-client calls accordingly). Prefer body for parity with `upsert`.
- `projectsQueryOptions` import path: `@better-update/api-client/react` (confirmed
  via `-project-switcher.tsx`).
- `/settings` layout route consuming `ORG_SETTINGS_NAV`: if absent, the new
  `env-access.tsx` renders its own `PageHeader` like `roles.tsx` and the nav link
  still resolves; do NOT invent a layout route.
- `toApiReadEffect` vs `toApiBadRequestReadEffect`: the env-grants handler uses
  `toApiReadEffect` (mirror `channel-grants.ts`). Confirm it maps `NotFound` +
  `Forbidden` + `BadRequest` correctly for this group's declared error set.
