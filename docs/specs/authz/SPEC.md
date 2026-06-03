# IAM-Style Authorization — Authoritative Implementation Spec

Status: AUTHORITATIVE. Implementers follow this EXACTLY, in parallel. Each file
below belongs to exactly ONE slice (see §2). Do not edit a file owned by another
slice; coordinate through the shared symbols this spec defines.

Toolchain reminders (project rules): `bun`/`bunx` only; `bun run lint` for
lint+typecheck; `bun run format` (oxfmt). Extensionless imports. No `== null`
(`no-eq-null`); use truthy / `!x?.y`. Lint may flake on spurious `no-unsafe-*`
"error typed value" — re-run once; if it vanishes, ignore.

---

## 1. Overview + the three decisions

We add three stacked, all-server-enforced authorization layers on top of the
existing Effect `HttpApi`. The Effect functional core is preserved: every gate is
an Effect value, resolution happens once in `auth/middleware.ts` (built-in/custom
role baseline) and lazily per-check for scoped grants.

**L1 — Static RBAC (better-auth `createAccessControl`).** A single
`AccessControl` `ac` + 4 roles (`owner`/`admin`/`developer`/`viewer`) DERIVED from
`apps/server/src/auth/permissions.ts` (single source of truth — zero duplication
via `buildStatement`/`buildRole` helpers). Registered on the `organization()`
plugin so `developer`/`viewer` become first-class assignable through better-auth.
This KILLS the direct-D1 `UPDATE member.role` hack. A new `ac` Resource is added to
`models.ts` granted to `owner`/`admin` only (managing custom roles). The statement
merges better-auth `defaultStatements` (`organization`/`member`/`invitation`/
`team`/`ac`) with our resources.

**L2 — Dynamic custom roles per org (`dynamicAccessControl`).** Orgs create/
update/delete custom roles at runtime, stored in better-auth's `organizationRole`
table (snake_case-mapped + migration). Middleware resolves `effectivePermissions`
for BOTH built-in roles (static map lookup, no query) AND custom roles (read org
role permissions). `assertPermission` stays an Effect value reading
`CurrentActor.effectivePermissions`; resolution happens ONCE per request in
`auth/middleware.ts` and is cached into the auth context. The hardcoded `isRole`
whitelist is relaxed.

**L3 — Per-channel ABAC scope (the IAM goal).** New generic grant table
`environment_grant`. New repo port+Live `repositories/environment-grant-repo.ts`.
New `auth/scope.ts` exports `assertPermissionOn(resource, action, scope)` where
`scope = { scopeKind: "channel", scopeId }`. It yields `CurrentActor` + the grant
repo LAZILY (per-check; grants are NOT preloaded into context). Resolution is
HYBRID, DENY-WINS (see §7). `assertPermission` (org-wide) is unchanged for
non-scoped checks.

**Channel-scoped conversions** (recon `handler-scope-surface.md`): channel
mutations + publish/republish to a channel + rollouts + channel↔branch mapping.
Org-wide resources (member, project create, billing, apiKey, org-vault,
credentials, env-vars) keep plain `assertPermission`. Env-vars keep plain
`assertPermission` — their `environment` enum is a SEPARATE axis; the grant model
is generic enough to extend later (see §12 FOLLOW-UPS), NOT implemented now.

**API-key principals** (`member_id === null`) have no scoped grants in v1: they
keep metadata-based org-wide permissions. `assertPermissionOn` falls back to the
role/metadata baseline only — no allow/deny grants apply (documented in §7).

**No backward compat, no data migration** — prod has zero users. Breaking schema/
behavior changes are fine. Do NOT write backfill/migration-data SQL.

---

## 2. FILE OWNERSHIP TABLE

Every file appears in exactly ONE slice. Slices: CONTRACTS (`packages/api`), CORE
(server authz primitives + migrations + auth.ts), HANDLERS (server handlers),
AUTH-CLIENT, WEB, CLI, TESTS.

### CORE (apps/server authz primitives + migrations + auth wiring)

| File                                                     | New/Edit | What                                                                                                               |
| -------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| `apps/server/src/auth/access-control.ts`                 | NEW      | `buildStatement`, `buildRole`, the `statement`, `ac`, the 4 roles `{owner,admin,developer,viewer}`, `acRoles` map. |
| `apps/server/src/auth/scope.ts`                          | NEW      | `assertPermissionOn(resource, action, scope)` + `ScopeKind`/`Scope` types + deny-wins resolver.                    |
| `apps/server/src/repositories/environment-grant-repo.ts` | NEW      | `EnvironmentGrantRepo` port + `EnvironmentGrantRepoLive` D1 adapter.                                               |
| `apps/server/src/repositories/org-role-repo.ts`          | NEW      | `OrgRoleRepo` port + `OrgRoleRepoLive` (reads `organization_role.permission`; used by middleware + role handlers). |
| `apps/server/migrations/0054_organization_role.sql`      | NEW      | better-auth dynamic-AC table.                                                                                      |
| `apps/server/migrations/0055_environment_grant.sql`      | NEW      | grant table.                                                                                                       |
| `apps/server/src/auth.ts`                                | EDIT     | Register `ac` + roles + `dynamicAccessControl` + `organizationRole` snake_case schema on `organization()`.         |
| `apps/server/src/auth/middleware.ts`                     | EDIT     | Resolve `effectivePermissions` for built-in vs custom role; relax `isRole`.                                        |
| `apps/server/src/auth/permissions.ts`                    | EDIT     | Add `ac` to `owner`/`admin` permission maps (single source of truth).                                              |
| `apps/server/src/models.ts`                              | EDIT     | Add `"ac"` to `Resource` union; add `EnvironmentGrantModel`, `OrgRoleModel`, `GrantEffect`, `ScopeKind` types.     |
| `apps/server/src/repositories/channels.ts`               | EDIT     | Add `findByBranchId({ branchId })` read (consumed by HANDLERS rollout% gate).                                      |
| `apps/server/src/infrastructure-layer.ts`                | EDIT     | Add `EnvironmentGrantRepoLive` + `OrgRoleRepoLive` (+ `MemberRepoLive`) to imports + `RepositoryLayer`.            |

### CONTRACTS (packages/api)

| File                                        | New/Edit | What                                                                                                                       |
| ------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| `packages/api/src/domain/org-role.ts`       | NEW      | `OrgRole`, `CreateOrgRoleBody`, `UpdateOrgRoleBody`, `ListOrgRolesParams`, `DeleteOrgRoleResult`, `PermissionGrantSchema`. |
| `packages/api/src/groups/org-roles.ts`      | NEW      | `OrgRolesGroup` (`/api/roles`).                                                                                            |
| `packages/api/src/domain/channel-grant.ts`  | NEW      | `ChannelGrant`, `UpsertChannelGrantBody`, `ListChannelGrantsParams`, `DeleteChannelGrantResult`.                           |
| `packages/api/src/groups/channel-grants.ts` | NEW      | `ChannelGrantsGroup` (`/api/channels/:id/grants`).                                                                         |
| `packages/api/src/api.ts`                   | EDIT     | `.add(OrgRolesGroup).add(ChannelGrantsGroup)`.                                                                             |
| `packages/api/src/auth/context.ts`          | EDIT     | Add `"ac"` to `Resource`; widen `Role` to `string` baseline + named built-ins (see §3).                                    |

### HANDLERS (apps/server handlers)

| File                                           | New/Edit | What                                                                             |
| ---------------------------------------------- | -------- | -------------------------------------------------------------------------------- |
| `apps/server/src/handlers/channels.ts`         | EDIT     | Convert 10 sites to `assertPermissionOn("channel"…)` (P0).                       |
| `apps/server/src/handlers/updates.ts`          | EDIT     | Publish (P1) + republish (P2) + rollout% (P3) → scoped.                          |
| `apps/server/src/handlers/update-republish.ts` | EDIT     | `resolveRepublishDestination` returns `channelId`.                               |
| `apps/server/src/handlers/org-roles.ts`        | NEW      | `OrgRolesGroupLive` — role CRUD; `ac:*` gates.                                   |
| `apps/server/src/handlers/channel-grants.ts`   | NEW      | `ChannelGrantsGroupLive` — grant CRUD; `member:update` gate + channel ownership. |
| `apps/server/src/handlers/index.ts`            | EDIT     | Export `OrgRolesGroupLive`, `ChannelGrantsGroupLive`.                            |
| `apps/server/src/app-layer.ts`                 | EDIT     | Import + merge the two new GroupLive layers.                                     |

> HANDLERS owns `app-layer.ts` and `handlers/index.ts`. CORE owns
> `infrastructure-layer.ts`. They never overlap.

### AUTH-CLIENT

| File                                | New/Edit | What                                                                                                                                       |
| ----------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/auth-client/src/index.ts` | EDIT     | Add `inferAdditionalFields({ member: { role: { type: "string" } } })` + `dynamicAccessControl: { enabled: true }` on `organizationClient`. |

### WEB

| File                                                                                                | New/Edit | What                                                                    |
| --------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------- |
| `apps/web/src/routes/_authed/_app/settings/roles.tsx`                                               | NEW      | Org role management page.                                               |
| `apps/web/src/routes/_authed/_app/settings/-roles-table.tsx`                                        | NEW      | `RolesTableView` (DataTableView).                                       |
| `apps/web/src/routes/_authed/_app/settings/-role-form-dialog.tsx`                                   | NEW      | Keyed create/edit dialog.                                               |
| `apps/web/src/routes/_authed/_app/projects/$projectSlug/channels/$channelId/grants.tsx`             | NEW      | Per-channel grant panel.                                                |
| `apps/web/src/routes/_authed/_app/projects/$projectSlug/channels/$channelId/-grants-table.tsx`      | NEW      | `GrantsTableView`.                                                      |
| `apps/web/src/routes/_authed/_app/projects/$projectSlug/channels/$channelId/-grant-form-dialog.tsx` | NEW      | Keyed upsert dialog.                                                    |
| `apps/web/src/queries/org.ts`                                                                       | EDIT     | Add `rolesQueryOptions`, `channelGrantsQueryOptions`, mutation helpers. |
| `apps/web/src/components/settings-layout.tsx`                                                       | EDIT     | Add "Roles" nav link.                                                   |

### CLI

| File                                              | New/Edit | What                      |
| ------------------------------------------------- | -------- | ------------------------- |
| `apps/cli/src/commands/roles/index.ts`            | NEW      | `rolesCommand`.           |
| `apps/cli/src/commands/roles/list.ts`             | NEW      | `roles list`.             |
| `apps/cli/src/commands/roles/create.ts`           | NEW      | `roles create`.           |
| `apps/cli/src/commands/roles/view.ts`             | NEW      | `roles view`.             |
| `apps/cli/src/commands/roles/update.ts`           | NEW      | `roles update`.           |
| `apps/cli/src/commands/roles/delete.ts`           | NEW      | `roles delete`.           |
| `apps/cli/src/commands/channels/grants/index.ts`  | NEW      | `channels grants` group.  |
| `apps/cli/src/commands/channels/grants/list.ts`   | NEW      | `channels grants list`.   |
| `apps/cli/src/commands/channels/grants/set.ts`    | NEW      | `channels grants set`.    |
| `apps/cli/src/commands/channels/grants/revoke.ts` | NEW      | `channels grants revoke`. |
| `apps/cli/src/command-registry.ts`                | EDIT     | `roles: rolesCommand`.    |
| `apps/cli/src/commands/channels/index.ts`         | EDIT     | `grants: grantsCommand`.  |

### TESTS

| File                                                | New/Edit | What                                                          |
| --------------------------------------------------- | -------- | ------------------------------------------------------------- |
| `apps/server/src/auth/access-control.test.ts`       | NEW      | Statement/role derivation parity vs `permissions.ts`.         |
| `apps/server/src/auth/scope.test.ts`                | NEW      | Deny-wins resolution truth table.                             |
| `apps/server/src/auth/permissions.test.ts`          | EDIT     | Add `ac` rows for owner/admin.                                |
| `apps/server/tests/e2e/roles-flow.test.ts`          | NEW      | Custom role create/assign + viewer/developer RBAC boundaries. |
| `apps/server/tests/e2e/channel-grants-flow.test.ts` | NEW      | Per-channel allow/deny grant boundaries.                      |
| `apps/server/tests/e2e/vault-flow.test.ts`          | EDIT     | Replace raw D1 `UPDATE member.role` with API role assignment. |

> TESTS owns `vault-flow.test.ts` and `permissions.test.ts` edits. CORE must NOT
> touch `permissions.test.ts` (only `permissions.ts`). The TESTS slice depends on
> CORE+HANDLERS+CONTRACTS landing first (integration order, not file overlap).

---

## 3. AccessControl statement + 4 roles derived from `permissions.ts`

### 3a. New `ac` Resource in `models.ts` + `permissions.ts`

`apps/server/src/models.ts` — add `"ac"` to the `Resource` union (CORE):

```ts
export type Resource =
  | "organization"
  | "member"
  | "invitation"
  | "ac" // NEW — manage custom roles (better-auth dynamic AC meta-resource)
  | "project"
  // …unchanged…
  | "vaultAccess";
```

`packages/api/src/auth/context.ts` — mirror `"ac"` into its `Resource` union
(CONTRACTS slice; this file is a duplicated type used cross-package). Also widen
`Role`:

```ts
// Built-in role names stay nominal for the static map; custom roles are arbitrary
// lowercased strings. The widened alias keeps member.role assignable to any string.
export type BuiltinRole = "owner" | "admin" | "developer" | "viewer";
export type Role = BuiltinRole | (string & {});
```

`apps/server/src/auth/permissions.ts` — add `ac` to `owner` and `admin` ONLY
(CORE). It is the source of truth `buildStatement`/`buildRole` read from:

```ts
owner: {
  organization: ["read", "update", "delete"],
  member: ["read", "create", "update", "delete"],
  invitation: ["read", "create", "cancel"],
  ac: ["create", "read", "update", "delete"],   // NEW
  project: ["read", "create", "update", "delete"],
  // …unchanged…
},
admin: {
  organization: ["read"],
  member: ["read", "create", "update", "delete"],
  invitation: ["read", "create", "cancel"],
  ac: ["create", "read", "update", "delete"],   // NEW
  project: ["read", "create", "update", "delete"],
  // …unchanged…
},
// developer + viewer: NO ac key (cannot manage roles)
```

Note: `Action` already includes `read`/`create`/`update`/`delete` — `ac` needs no
new action. The existing `Action` union is unchanged.

### 3b. `apps/server/src/auth/access-control.ts` (NEW, CORE) — FULL CONTENT

```ts
import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/organization/access";

import { permissions } from "./permissions";

import type { Role as AppRole } from "../models";

// ── Derivation helpers (single source of truth = permissions.ts) ──

/**
 * Collapse the static permission map into a better-auth `Statements` object:
 * `{ resource: union-of-every-action-any-role-grants }`. This is the SUPERSET of
 * actions per resource — the menu of grantable permissions, not a per-role grant.
 * Merged with better-auth's org `defaultStatements` (organization/member/
 * invitation/team/ac) so the org built-ins (esp. `ac`, required for dynamic AC)
 * stay present.
 */
export const buildStatement = (): Record<string, readonly string[]> => {
  const acc: Record<string, Set<string>> = {};
  for (const role of Object.keys(permissions) as AppRole[]) {
    const resourceMap = permissions[role];
    for (const [resource, actions] of Object.entries(resourceMap)) {
      acc[resource] ??= new Set<string>();
      for (const action of actions ?? []) {
        acc[resource].add(action);
      }
    }
  }
  const out: Record<string, readonly string[]> = {};
  for (const [resource, set] of Object.entries(acc)) {
    out[resource] = [...set];
  }
  return out;
};

// `defaultStatements` first so our same-named resources (organization/member/
// invitation) override with our richer action sets; `team` + `ac` survive from
// the defaults (and we also re-supply `ac` via permissions.ts owner/admin).
export const statement = {
  ...defaultStatements,
  ...buildStatement(),
} as const;

export const ac = createAccessControl(statement);

/**
 * Build one better-auth `Role` from a single role's slice of permissions.ts.
 * `ac.newRole(perm)` === `role(perm)`; the literal `{resource: actions}` map is
 * exactly what the static map already holds.
 */
const buildRole = (role: AppRole) => {
  const resourceMap = permissions[role];
  const perm: Record<string, readonly string[]> = {};
  for (const [resource, actions] of Object.entries(resourceMap)) {
    perm[resource] = [...(actions ?? [])];
  }
  return ac.newRole(perm);
};

export const owner = buildRole("owner");
export const admin = buildRole("admin");
export const developer = buildRole("developer");
export const viewer = buildRole("viewer");

/**
 * Name → Role. Passed to `organization({ roles })`. NOTE: supplying `roles`
 * REPLACES better-auth's default name set used by guard logic (recon §3), so the
 * built-in `member` name is intentionally dropped — our role set is owner/admin/
 * developer/viewer. `creatorRole: "owner"` stays valid (owner is present).
 */
export const acRoles = { owner, admin, developer, viewer } as const;
```

Derivation rule (assert in tests, §11): for every built-in role `R` and resource
`res`, `acRoles[R].statements[res]` set-equals `permissions[R][res]`, and
`Object.keys(statement)` ⊇ every resource named in any role + `team`.

---

## 4. EDIT: `apps/server/src/auth.ts` — register L1 + L2 (CORE)

Add import at top:

```ts
import { ac, acRoles } from "./auth/access-control";
```

Inside the `organization({ … })` call, add three top-level options and one schema
block. Place `ac`/`roles`/`dynamicAccessControl` alongside the existing
`creatorRole: "owner"`:

```ts
organization({
  allowUserToCreateOrganization: async (user) => isUserApprovedOrAdmin(env.DB, user.id),
  organizationLimit: 5,
  membershipLimit: 100,
  creatorRole: "owner",
  ac,                                   // L1: our AccessControl instance
  roles: acRoles,                       // L1: owner/admin/developer/viewer assignable
  dynamicAccessControl: { enabled: true, maximumRolesPerOrganization: 50 }, // L2
  sendInvitationEmail: async (data) => { /* unchanged */ },
  schema: {
    session: { fields: { activeOrganizationId: "active_organization_id" } },
    organization: { fields: { createdAt: "created_at" } },
    member: {
      fields: { userId: "user_id", organizationId: "organization_id", createdAt: "created_at" },
    },
    invitation: {
      fields: {
        organizationId: "organization_id",
        inviterId: "inviter_id",
        expiresAt: "expires_at",
        createdAt: "created_at",
      },
    },
    // NEW — better-auth dynamic-AC role table; snake_case column mapping.
    // Model key = "organizationRole"; physical table = "organization_role".
    organizationRole: {
      modelName: "organization_role",
      fields: {
        organizationId: "organization_id",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
  },
}),
```

Column set (recon `betterauth-ac-api.md` §4): `id`, `organizationId`→
`organization_id` (FK org.id, indexed), `role` (name, lowercased, indexed),
`permission` (JSON string `Record<string,string[]>`), `createdAt`→`created_at`,
`updatedAt`→`updated_at` (nullable). `role` and `permission` already match
snake-trivially (single words) so only `organizationId`/`createdAt`/`updatedAt`
need mapping.

### Migration `0054_organization_role.sql` (CORE) — FULL SQL

```sql
-- Dynamic Access Control role table (better-auth `organization` plugin,
-- dynamicAccessControl.enabled). One row = one custom role for one org.
-- `permission` is a JSON-encoded Record<string, string[]> (resource -> actions).
-- See docs/specs/authz/recon/betterauth-ac-api.md §4.

CREATE TABLE "organization_role" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "organization_id" TEXT NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  "role"            TEXT NOT NULL,
  "permission"      TEXT NOT NULL,
  "created_at"      DATE NOT NULL,
  "updated_at"      DATE
);

CREATE INDEX "organization_role_organization_id_idx"
  ON "organization_role" ("organization_id");

CREATE INDEX "organization_role_role_idx"
  ON "organization_role" ("role");

CREATE UNIQUE INDEX "organization_role_org_name_idx"
  ON "organization_role" ("organization_id", "role");
```

`created_at`/`updated_at` are `DATE` (better-auth sets values in code, no SQL
default), matching the existing better-auth table convention (recon
`schema-migration.md` §5). The unique index enforces "one role name per org",
matching better-auth's collision check.

---

## 5. L3: grant table + repo + `auth/scope.ts` (CORE)

### 5a. Migration `0055_environment_grant.sql` — FULL SQL

```sql
-- Per-scope ABAC permission grants. v1 scope_kind = 'channel' only; column kept
-- generic so 'branch'/'env_var_environment' can extend later without a migration.
-- effect IN ('allow','deny'); deny wins in resolution. actions = JSON array of
-- "resource:action" strings, e.g. '["update:create","rollout:update"]'.
-- See docs/specs/authz/SPEC.md §7.

CREATE TABLE "environment_grant" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "organization_id" TEXT NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  "member_id"       TEXT NOT NULL REFERENCES "member" ("id") ON DELETE CASCADE,
  "scope_kind"      TEXT NOT NULL CHECK ("scope_kind" IN ('channel')),
  "scope_id"        TEXT NOT NULL,
  "effect"          TEXT NOT NULL CHECK ("effect" IN ('allow', 'deny')),
  "actions"         TEXT NOT NULL,
  "created_at"      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Resolution lookup: a member's grants on a specific scope object.
CREATE INDEX "idx_environment_grant_member_scope"
  ON "environment_grant" ("member_id", "scope_kind", "scope_id");

-- Scope-side sweep: revoke all grants when a channel is deleted.
CREATE INDEX "idx_environment_grant_scope"
  ON "environment_grant" ("scope_kind", "scope_id");

-- One row per (member, scope, effect): the upsert target. Action-level merge
-- happens inside the JSON array, enforced by the application.
CREATE UNIQUE INDEX "idx_environment_grant_unique"
  ON "environment_grant" ("member_id", "scope_kind", "scope_id", "effect");
```

Note: `scope_kind` CHECK is `IN ('channel')` for v1 (generic column, single
allowed value now). Adding `'branch'` etc. later is a one-line CHECK migration.
Channel delete must `DELETE FROM environment_grant WHERE scope_kind='channel' AND
scope_id=?` — add this to `ChannelRepo.delete`'s batch in HANDLERS? **No** —
`ChannelRepo` is CORE-adjacent but owned elsewhere; instead the grant repo exposes
`deleteByScope` and the channel delete handler (HANDLERS slice) calls it. See §9
gate notes. (Orphan rows are harmless to resolution since they only match a
deleted channel id, but we sweep for hygiene.)

### 5b. `apps/server/src/models.ts` additions (CORE)

```ts
export type ScopeKind = "channel";
export type GrantEffect = "allow" | "deny";

export interface EnvironmentGrantModel {
  readonly id: string;
  readonly organizationId: string;
  readonly memberId: string;
  readonly scopeKind: ScopeKind;
  readonly scopeId: string;
  readonly effect: GrantEffect;
  /** Decoded JSON array of "resource:action" strings. */
  readonly actions: readonly string[];
  readonly createdAt: string;
}

export interface OrgRoleModel {
  readonly id: string;
  readonly organizationId: string;
  readonly role: string;
  /** Decoded Record<resource, actions[]>. */
  readonly permission: Partial<Record<Resource, readonly Action[]>>;
  readonly createdAt: string;
  readonly updatedAt: string | null;
}
```

### 5c. `apps/server/src/repositories/environment-grant-repo.ts` (NEW, CORE)

Port (`Context.Tag`) + colocated D1 `Live`. `Effect.promise`/`tryPromise` allowed
here (I/O boundary). The actions column is JSON `string[]` on disk, decoded to
`readonly string[]`.

```ts
export interface EnvironmentGrantRepository {
  /**
   * All grants for ONE member on ONE scope object. Used by assertPermissionOn.
   * Returns both allow + deny rows (caller applies deny-wins).
   */
  readonly findForMemberOnScope: (params: {
    readonly memberId: string;
    readonly scopeKind: ScopeKind;
    readonly scopeId: string;
  }) => Effect.Effect<readonly EnvironmentGrantModel[]>;

  /** All grants on a scope (for the grants list UI/handler). */
  readonly findByScope: (params: {
    readonly scopeKind: ScopeKind;
    readonly scopeId: string;
  }) => Effect.Effect<readonly EnvironmentGrantModel[]>;

  /**
   * Upsert ONE (member, scope, effect) row by replacing its `actions` JSON.
   * The grant handler writes effect="allow" with the full action set; deny rows
   * are written the same way with effect="deny". organizationId is required for
   * the FK + tenant scoping.
   */
  readonly upsert: (params: {
    readonly organizationId: string;
    readonly memberId: string;
    readonly scopeKind: ScopeKind;
    readonly scopeId: string;
    readonly effect: GrantEffect;
    readonly actions: readonly string[];
  }) => Effect.Effect<EnvironmentGrantModel>;

  /** Remove all grants (both effects) for one member on one scope. */
  readonly deleteForMemberOnScope: (params: {
    readonly memberId: string;
    readonly scopeKind: ScopeKind;
    readonly scopeId: string;
  }) => Effect.Effect<void>;

  /** Sweep all grants on a scope (called when the scope object is deleted). */
  readonly deleteByScope: (params: {
    readonly scopeKind: ScopeKind;
    readonly scopeId: string;
  }) => Effect.Effect<void>;
}

export class EnvironmentGrantRepo extends Context.Tag("api/EnvironmentGrantRepo")<
  EnvironmentGrantRepo,
  EnvironmentGrantRepository
>() {}
```

`Live` (colocated): row type `{ id; organization_id; member_id; scope_kind;
scope_id; effect; actions; created_at }`; `toModel` does
`JSON.parse(row.actions) as string[]`. `upsert` uses
`INSERT … ON CONFLICT("member_id","scope_kind","scope_id","effect") DO UPDATE SET
"actions"=excluded."actions"` (the unique index is the conflict target), returning
the row. `deleteForMemberOnScope` deletes both effect rows. `findForMemberOnScope`
selects `WHERE member_id=? AND scope_kind=? AND scope_id=?`.

### 5d. `apps/server/src/repositories/org-role-repo.ts` (NEW, CORE)

Reads `organization_role` for middleware custom-role resolution AND backs the role
handlers' list/get (the handlers use the better-auth API for write, this repo for
read where convenient — but to keep handlers off direct adapter access, role
list/get in handlers go through better-auth endpoints; this repo's primary
consumer is `middleware.ts`). Port:

```ts
export interface OrgRoleRepository {
  /** One org's custom role permission map by role NAME (lowercased). null if absent. */
  readonly findByName: (params: {
    readonly organizationId: string;
    readonly role: string;
  }) => Effect.Effect<Partial<Record<Resource, readonly Action[]>> | null>;
}

export class OrgRoleRepo extends Context.Tag("api/OrgRoleRepo")<OrgRoleRepo, OrgRoleRepository>() {}
```

`Live`: `SELECT "permission" FROM "organization_role" WHERE "organization_id"=? AND
"role"=?`, `JSON.parse` the column → `Record<string,string[]>`, return as
`Partial<Record<Resource, readonly Action[]>>` (cast is safe — better-auth stored
our resource/action strings). Returns `null` when no row.

### 5e. `apps/server/src/auth/scope.ts` (NEW, CORE) — signature + algorithm

```ts
import { Effect } from "effect";

import { Forbidden } from "../errors";
import { CurrentActor } from "./current-actor";
import { EnvironmentGrantRepo } from "../repositories/environment-grant-repo";

import type { Action, Resource, ScopeKind } from "../models";

export interface Scope {
  readonly scopeKind: ScopeKind; // "channel"
  readonly scopeId: string; // the channel id
}

/**
 * Per-scope (ABAC) gate. DENY-WINS hybrid:
 *   1. matching DENY grant on this scope -> Forbidden
 *   2. else role baseline (ctx.effectivePermissions) allows -> allow
 *   3. else matching ALLOW grant on this scope -> allow
 *   4. else -> Forbidden
 * Grants are read LAZILY here (per check), never preloaded into the auth context.
 * API-key actors (userId === null / no member id) have no grants in v1: steps 1
 * and 3 short-circuit to "no grants", so resolution reduces to the role/metadata
 * baseline (step 2) only.
 */
export const assertPermissionOn = (resource: Resource, action: Action, scope: Scope) =>
  Effect.gen(function* () {
    const ctx = yield* CurrentActor;
    const token = `${resource}:${action}`;

    // No member identity (API key) -> baseline only; no allow/deny grants apply.
    const memberId = ctx.memberId; // see §8: middleware must surface memberId
    if (!memberId) {
      const baseline = ctx.effectivePermissions[resource]?.includes(action) ?? false;
      if (!baseline) {
        yield* new Forbidden({ message: `Insufficient permission: ${token}` });
      }
      return;
    }

    const repo = yield* EnvironmentGrantRepo;
    const grants = yield* repo.findForMemberOnScope({
      memberId,
      scopeKind: scope.scopeKind,
      scopeId: scope.scopeId,
    });

    const denied = grants.some((g) => g.effect === "deny" && g.actions.includes(token));
    if (denied) {
      yield* new Forbidden({ message: `Denied by scope grant: ${token}` });
      return;
    }

    const baseline = ctx.effectivePermissions[resource]?.includes(action) ?? false;
    if (baseline) {
      return; // role baseline grants it and no deny overrode
    }

    const allowed = grants.some((g) => g.effect === "allow" && g.actions.includes(token));
    if (!allowed) {
      yield* new Forbidden({ message: `Insufficient permission: ${token}` });
    }
  });
```

`memberId` requirement: `assertPermissionOn` reads `ctx.memberId`. CORE adds
`memberId: string | null` to `CurrentActor` (models.ts) + `AuthContextShape`
(context.ts) + threads it through `current-actor.ts` and `middleware.ts` (§8).

---

## 6. (covered in §4) dynamicAccessControl wiring + organizationRole schema + migration

See §4 (auth.ts edit + 0054 migration). Recap of the exact dynamic config key:
`dynamicAccessControl: { enabled: true, maximumRolesPerOrganization: 50 }`. The
`ac` resource on owner/admin (§3a) is what authorizes the better-auth
create/update/delete-role endpoints (recon §8).

---

## 7. Deny-wins resolution algorithm (canonical pseudocode)

```
assertPermissionOn(resource, action, scope):
  ctx   = CurrentActor
  token = resource + ":" + action

  if ctx.memberId is null:                      # API-key principal
      if baselineAllows(ctx, resource, action): return OK
      else:                                      return Forbidden

  grants = EnvironmentGrantRepo.findForMemberOnScope(ctx.memberId, scope)  # lazy

  if any g in grants where g.effect == "deny"  and token in g.actions:
      return Forbidden                          # (1) DENY WINS

  if baselineAllows(ctx, resource, action):
      return OK                                  # (2) role baseline

  if any g in grants where g.effect == "allow" and token in g.actions:
      return OK                                  # (3) explicit allow grant

  return Forbidden                               # (4) default deny

baselineAllows(ctx, resource, action) = action in (ctx.effectivePermissions[resource] or [])
```

Precedence: **deny > role-baseline > allow-grant > default-deny.** A deny grant
beats both the role baseline and any allow grant (so you can subtract a channel
from an admin). An allow grant only matters when the baseline does NOT already
grant it (so you can add a single channel to a viewer). `assertPermission`
(org-wide, §`permissions.ts`) is unchanged and pure — no repo, just
`ctx.effectivePermissions`.

---

## 8. `middleware.ts` effectivePermissions resolution + relaxed `isRole` (CORE)

### 8a. Thread `memberId` through the context

- `models.ts` `CurrentActor` + `context.ts` `AuthContextShape`: add
  `readonly memberId: string | null;`.
- `current-actor.ts`: add `memberId: ctx.memberId` to the mapped object.
- `getActiveMember` returns `{ role, userId, organizationId }` — better-auth's
  active member result also carries `id` (the member row id). Extend the
  `ActiveMember` interface in `middleware.ts` with `readonly id: string;` and use
  it as `memberId` in the session branch. API-key branch sets `memberId: null`.

### 8b. Resolve effectivePermissions for built-in vs custom role

Replace the session-branch role handling. Current code:

```ts
const member = yield * getActiveMember(headers);
if (!member || !isRole(member.role)) {
  return yield * new Unauthorized({ message: "Not a member of the active organization" });
}
return {
  // …
  role: member.role,
  effectivePermissions: permissions[member.role],
  // …
} as const satisfies AuthContextShape;
```

New logic (resolve ONCE, cache into context):

```ts
const member = yield * getActiveMember(headers);
if (!member) {
  return yield * new Unauthorized({ message: "Not a member of the active organization" });
}

// member.role may be a built-in name OR a custom-role name (or a comma-joined
// list, better-auth allows multi-role). Resolve to a single effective-permissions
// map: built-ins come from the static map (no query); unknown names are custom
// roles read from organization_role (one D1 read), merged onto any same-named
// built-in. Resolution happens HERE, once per request, and is cached in ctx.
const effectivePermissions =
  yield *
  resolveEffectivePermissions({
    organizationId: orgId,
    roleSpec: member.role,
  });

return {
  userId: session.user.id,
  organizationId: orgId,
  memberId: member.id,
  role: member.role, // raw role string (may be custom)
  effectivePermissions,
  source: "session",
  transport,
  actorEmail: session.user.email,
  isSuperadmin: authState.isSuperadmin,
} as const satisfies AuthContextShape;
```

`resolveEffectivePermissions` (new helper in `middleware.ts`, yields
`OrgRoleRepo`):

```ts
const isBuiltinRole = (value: string): value is Role =>
  ["owner", "admin", "developer", "viewer"].includes(value);

const resolveEffectivePermissions = (params: {
  readonly organizationId: string;
  readonly roleSpec: string;
}) =>
  Effect.gen(function* () {
    const repo = yield* OrgRoleRepo;
    const names = params.roleSpec
      .split(",")
      .map((r) => r.trim())
      .filter((r) => r.length > 0);
    const merged: Record<string, Set<string>> = {};
    for (const name of names) {
      // built-in: static map, no query
      const builtin = isBuiltinRole(name) ? permissions[name] : undefined;
      // custom: one D1 read (only when not a built-in OR to merge over it)
      const custom = yield* repo.findByName({ organizationId: params.organizationId, role: name });
      const source = builtin ?? custom;
      if (!source && !custom) {
        continue; // unknown role name contributes nothing
      }
      for (const [resource, actions] of Object.entries({ ...builtin, ...custom })) {
        merged[resource] ??= new Set<string>();
        for (const a of actions ?? []) merged[resource].add(a);
      }
    }
    const out: EffectivePermissions = {};
    for (const [resource, set] of Object.entries(merged)) {
      out[resource as Resource] = [...set] as readonly Action[];
    }
    return out;
  });
```

Notes:

- Built-in roles still cost ZERO queries when the member has only built-in
  role(s) — the `repo.findByName` call returns `null` fast (single PK-ish lookup);
  to keep built-in-only the strict zero-query path, guard: only call
  `repo.findByName` when `!isBuiltinRole(name)`. (Implementer: skip the custom read
  for pure built-in names.) Final rule: **built-in name → static map only; any
  non-built-in name → one read from `organization_role`.**
- This is the ONLY place custom-role permissions are read per request. Downstream
  `assertPermission`/`assertPermissionOn` read the cached `effectivePermissions`.

### 8c. Relax `isRole`

The old `isRole` whitelist (`["owner","admin","developer","viewer"]`) gated the
session branch and would reject any custom role. It is REPLACED:

- Remove the hard `!isRole(member.role)` rejection (a member with a valid custom
  role must be accepted).
- Keep `isBuiltinRole` (renamed, §8b) purely as the "use static map vs query"
  switch — NOT as an accept/reject gate.
- `context.ts` `Role` is widened (§3a) so `role: member.role` (an arbitrary
  string) type-checks.

API-key branch: unchanged except `memberId: null` and
`effectivePermissions: result.key.permissions ?? permissions.admin` stays
(metadata baseline). API keys never get custom-role or grant resolution.

---

## 9. API contracts + handler signatures + gates

### 9a. CONTRACTS — `packages/api/src/domain/org-role.ts` (NEW)

```ts
import { Schema } from "effect";
import { DateTimeString, Id } from "./common";

// One resource→actions grant inside a role's permission set.
export const PermissionGrantSchema = Schema.Struct({
  resource: Schema.String,
  actions: Schema.Array(Schema.String),
});

export class OrgRole extends Schema.Class<OrgRole>("OrgRole")({
  id: Id,
  organizationId: Id,
  role: Schema.String, // role NAME
  permissions: Schema.Array(PermissionGrantSchema), // decoded from JSON
  createdAt: DateTimeString,
  updatedAt: Schema.NullOr(DateTimeString),
}) {}

export const CreateOrgRoleBody = Schema.Struct({
  name: Schema.String.pipe(Schema.minLength(1)),
  permissions: Schema.Array(PermissionGrantSchema),
});

export const UpdateOrgRoleBody = Schema.Struct({
  permissions: Schema.optional(Schema.Array(PermissionGrantSchema)),
  name: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
});

export const ListOrgRolesParams = Schema.Struct({
  organizationId: Id,
});

export const DeleteOrgRoleResult = Schema.Struct({ deleted: Schema.Number });
```

### 9b. CONTRACTS — `packages/api/src/groups/org-roles.ts` (NEW)

`OrgRolesGroup` mirrors `ChannelsGroup` structure (template-literal `idParam`,
`addError`). Endpoints:

| verb   | id       | path                    | payload/params                 | success                 |
| ------ | -------- | ----------------------- | ------------------------------ | ----------------------- |
| GET    | `list`   | `/api/roles`            | urlParams `ListOrgRolesParams` | `Schema.Array(OrgRole)` |
| POST   | `create` | `/api/roles`            | `CreateOrgRoleBody`            | `OrgRole` (201)         |
| GET    | `get`    | `/api/roles/${idParam}` | —                              | `OrgRole`               |
| PATCH  | `update` | `/api/roles/${idParam}` | `UpdateOrgRoleBody`            | `OrgRole`               |
| DELETE | `delete` | `/api/roles/${idParam}` | —                              | `DeleteOrgRoleResult`   |

`.addError(NotFound).addError(Conflict).addError(Forbidden)` (imports:
`Forbidden` from `../auth/errors`, `NotFound` from `../auth/ownership`, `Conflict`
from `../domain/errors` — same as channels group). List returns a plain array (not
`pageResult`) — role counts are small (cap 50).

### 9c. CONTRACTS — `packages/api/src/domain/channel-grant.ts` (NEW)

```ts
import { Schema } from "effect";
import { DateTimeString, Id } from "./common";

export const GrantEffectSchema = Schema.Literal("allow", "deny");

// One member's allow/deny set on a channel; `actions` are "resource:action".
export class ChannelGrant extends Schema.Class<ChannelGrant>("ChannelGrant")({
  id: Id,
  memberId: Id,
  scopeKind: Schema.Literal("channel"),
  scopeId: Id,
  effect: GrantEffectSchema,
  actions: Schema.Array(Schema.String),
  createdAt: DateTimeString,
}) {}

// Upsert one (member, channel, effect) grant. effect defaults to "allow".
export const UpsertChannelGrantBody = Schema.Struct({
  effect: Schema.optionalWith(GrantEffectSchema, { default: () => "allow" as const }),
  actions: Schema.Array(Schema.String).pipe(Schema.minItems(1)),
});

export const ListChannelGrantsParams = Schema.Struct({});

export const DeleteChannelGrantResult = Schema.Struct({ deleted: Schema.Number });
```

### 9d. CONTRACTS — `packages/api/src/groups/channel-grants.ts` (NEW)

`ChannelGrantsGroup`. Path uses two params; use the template-literal form with
`idParam` for the channel id and a `memberIdParam` (define a local `memberIdParam`
the same way `idParam` is defined in `domain/common`, or reuse `idParam` twice —
follow how existing two-param paths are built). Endpoints:

| verb   | id       | path                                               | payload                             | success                      |
| ------ | -------- | -------------------------------------------------- | ----------------------------------- | ---------------------------- |
| GET    | `list`   | `/api/channels/${idParam}/grants`                  | urlParams `ListChannelGrantsParams` | `Schema.Array(ChannelGrant)` |
| PUT    | `upsert` | `/api/channels/${idParam}/grants/${memberIdParam}` | `UpsertChannelGrantBody`            | `ChannelGrant`               |
| DELETE | `delete` | `/api/channels/${idParam}/grants/${memberIdParam}` | —                                   | `DeleteChannelGrantResult`   |

`.addError(NotFound).addError(Forbidden)`.

### 9e. CONTRACTS — `packages/api/src/api.ts` (EDIT)

Import both groups and append: `.add(OrgRolesGroup).add(ChannelGrantsGroup)`
before `.middleware(Authentication)`.

### 9f. HANDLERS — `apps/server/src/handlers/org-roles.ts` (NEW)

`OrgRolesGroupLive = HttpApiBuilder.group(ManagementApi, "roles", (h) => …)`. These
handlers do NOT use better-auth's HTTP endpoints (handlers are inside the Effect
runtime); instead they call `createAuth(env).api.{createOrgRole,updateOrgRole,
deleteOrgRole,listOrgRoles,getOrgRole}` via the same facade pattern as
`middleware.ts` (wrap with `Effect.tryPromise` inside the handler; this is a
handler calling an imperative-shell API, allowed via the auth facade — mirror how
`middleware.ts` wraps `authApi`). Each handler:

1. `yield* assertPermission("ac", <action>)` — `create`→`create`, `update`/get/
   list→`read`/`update`, `delete`→`delete`. Gate FIRST.
   - `list`/`get` → `assertPermission("ac", "read")`
   - `create` → `assertPermission("ac", "create")`
   - `update` → `assertPermission("ac", "update")`
   - `delete` → `assertPermission("ac", "delete")`
2. Map the contract body (`permissions: PermissionGrant[]`) to better-auth's
   `permission: Record<string,string[]>` and back (its responses parse JSON to
   object). Validate every `resource` is in `Object.keys(ac.statements)` is
   already enforced by better-auth (`INVALID_RESOURCE`); surface its error as
   `Conflict`/`BadRequest` via `toApiCrudEffect`.
3. `organizationId` comes from `ctx.organizationId` (CurrentActor), not the body,
   for create/update/delete; list uses `urlParams.organizationId` but the handler
   MUST assert it equals `ctx.organizationId` (else `NotFound`, anti-enumeration —
   mirror `assertOrgOwnership`).

> Because better-auth's own endpoints ALSO check `ac` permission against
> `member.role` (recon §8), the `assertPermission("ac", …)` call is belt-and-
> suspenders aligned with better-auth; keep both — our gate gives the uniform
> `Forbidden` shape and runs before the better-auth call.

### 9g. HANDLERS — `apps/server/src/handlers/channel-grants.ts` (NEW)

`ChannelGrantsGroupLive = HttpApiBuilder.group(ManagementApi, "channelGrants", …)`.
Each handler:

1. Resolve channel: `const channel = yield* ChannelRepo.findById({ id: path.id })`.
2. `yield* assertProjectOwnership(channel.projectId)` (tenant scoping → 404 cross-
   org).
3. Gate: `yield* assertPermission("member", "update")` — managing who can do what
   on a channel is a membership-admin action (owner/admin/developer have
   `member:update`? NO — only owner/admin have `member:update` per permissions.ts;
   developer/viewer do not. **Use `assertPermission("member", "update")`** so only
   owner/admin manage grants. This is the dedicated grant permission gate.)
4. `list` → `EnvironmentGrantRepo.findByScope({ scopeKind: "channel", scopeId:
path.id })` → map to `ChannelGrant[]`.
5. `upsert` → validate `path.memberId` is a member of `ctx.organizationId` (query
   member row; `NotFound` if not). Then `EnvironmentGrantRepo.upsert({
organizationId: ctx.organizationId, memberId: path.memberId, scopeKind:
"channel", scopeId: path.id, effect: payload.effect, actions: payload.actions })`.
   Validate each action token matches `^[a-zA-Z]+:[a-zA-Z]+$` and its `resource`
   ∈ statement resources (reject `BadRequest` otherwise).
6. `delete` → `EnvironmentGrantRepo.deleteForMemberOnScope({ memberId:
path.memberId, scopeKind: "channel", scopeId: path.id })` → `{ deleted: 1 }`.
7. `logAudit` on upsert/delete (`resourceType: "channel"`, action
   `channel.grant.set` / `channel.grant.revoke`).

> Member-existence lookup: add a small `MemberRepo.exists` OR reuse an existing
> member query. If none exists, the channel-grants handler may read the `member`
> table via a new tiny method on `EnvironmentGrantRepo` is WRONG (mixing
> concerns). Implementer: add `findMemberOrgId` to an existing member-aware repo
> if present; otherwise the handler does a direct env.DB read — NOT allowed
> (handlers must go through a repo). Resolution: CORE adds a `MemberRepo` port
> with `findOrgId({ memberId })` in `repositories/org-role-repo.ts` (colocate the
> member read there, it's the membership-meta repo) and HANDLERS yields it. **CORE
> owns `org-role-repo.ts`; add `MemberRepo` there.**

### 9h. HANDLERS — channel-scoped conversions

Convert these `assertPermission(...)` → `assertPermissionOn(..., { scopeKind:
"channel", scopeId })`. Import `assertPermissionOn` from `../auth/scope`.

`handlers/channels.ts` (10 sites; channelId = `path.id`, fetch channel first where
the gate currently precedes the fetch — reorder so the channel row is loaded, then
gate on its id; ownership assert stays):

- `update` (L101): `assertPermissionOn("channel", "update", { scopeKind:
"channel", scopeId: path.id })`.
- `pause` (L135) / `resume` (L147): same with `"channel","update"`.
- `createBranchRollout` (L159): `assertPermissionOn("rollout", "create", {…path.id})`.
- `updateBranchRollout` (L194) / `completeBranchRollout` (L215) /
  `revertBranchRollout` (L236): `assertPermissionOn("rollout", "update", {…path.id})`.
- `delete` (L253): `assertPermissionOn("channel", "delete", {…path.id})`; then ALSO
  `yield* EnvironmentGrantRepo.deleteByScope({ scopeKind: "channel", scopeId:
path.id })` after the channel delete (orphan sweep).
- `create` (L44): STAYS `assertPermission("channel", "create")` (no channel yet —
  org/project-level; recon P-note).
- `list` (L80): STAYS `assertPermission("channel", "read")` (project-scoped list).

> Reorder caveat: `update`/`pause`/`resume`/`rollout*`/`delete` already fetch the
> channel via `repo.findById({ id: path.id })` AFTER the assert. Since the scoped
> gate only needs `path.id` (not the row), keep the assert where it is but pass
> `path.id` directly — no reorder needed. (`scopeId = path.id`.)

`handlers/updates.ts`:

- Publish create (L114): currently `assertPermission("update","create")` fires
  before channel resolution. CHANGE: keep an early cheap org-level guard? No —
  spec requires scoped. The channelId is `branchValue.channelId`, available only
  AFTER `coordinator.ensureBranchChannel`. So: REMOVE the line-114
  `assertPermission`; after `const branchValue = branchResult.value;` (channelId
  known) and BEFORE any write to the update, insert `yield* assertPermissionOn(
"update", "create", { scopeKind: "channel", scopeId: branchValue.channelId })`.
  All validation before that point (id gate, signature verify, asset existence) is
  read-only/no-write, so gating after channel resolution but before the publish
  write preserves the trust boundary. Confirm no DB write occurs between L114 and
  the channelId resolution other than `ensureBranchChannel` (which is the
  channel-ensure itself; that is acceptable — it creates the channel the caller is
  publishing to, and ownership is already enforced via `assertProjectOwnership`).
- rollout% editRollout (L238): after fetching the update row (L241), do `const ch
= yield* ChannelRepo.findByBranchId(update.branchId)` then `assertPermissionOn(
"rollout","update",{ scopeKind:"channel", scopeId: ch.id })`. **CORE adds
  `findByBranchId` to `ChannelRepo`?** `ChannelRepo` is not in CORE's ownership
  table. Resolution: HANDLERS may add a read method to `ChannelRepo` ONLY if no
  slice conflict — but `channels.ts` repo is shared. To avoid two slices editing
  `repositories/channels.ts`, **CORE owns the `repositories/channels.ts` edit**
  (add `findByBranchId`) — add this row to CORE's table:
  - `apps/server/src/repositories/channels.ts` (EDIT, CORE): add
    `findByBranchId({ branchId }): Effect<ChannelModel | null>` (single channel for
    a branch; if multiple channels map a branch, return the first by created_at —
    document the ambiguity; rollout% gate uses the owning channel). HANDLERS
    consumes it.
- republish (L416): `resolveRepublishDestination` (in `update-republish.ts`,
  HANDLERS) returns `channelId`; gate `assertPermissionOn("update","create",{
scopeKind:"channel", scopeId: destination.channelId })`.

`handlers/update-republish.ts` (EDIT, HANDLERS): add `channelId` to the object
`resolveRepublishDestination` returns (it already fetches `destinationChannel`).

Org-wide handlers (projects, branches read/delete, env-vars, vault, credentials,
devices, webhooks, submissions, audit, builds, analytics, assets upload) STAY on
`assertPermission` — NO change (recon `handler-scope-surface.md` org-wide table).

### 9i. HANDLERS — registration

- `handlers/index.ts` (EDIT): `export { OrgRolesGroupLive } from "./org-roles";`
  and `export { ChannelGrantsGroupLive } from "./channel-grants";`.
- `app-layer.ts` (EDIT): import both from `./handlers` and add to the
  `Layer.mergeAll(...)` GroupLive list (alphabetical with the others).

### 9j. CORE — `infrastructure-layer.ts` (EDIT)

Import `EnvironmentGrantRepoLive`, `OrgRoleRepoLive`, `MemberRepoLive` (if
`MemberRepo` is colocated in `org-role-repo.ts`, its Live is exported there) and
add all to `RepositoryLayer = Layer.mergeAll(...)`.

---

## 10. Consumer changes

### 10a. AUTH-CLIENT — `packages/auth-client/src/index.ts` (EDIT)

```ts
organizationClient({ dynamicAccessControl: { enabled: true } }),
// …existing apiKeyClient(), oneTimeTokenClient(), adminClient()…
inferAdditionalFields({
  user: { approved: { type: "boolean" } },
  member: { role: { type: "string" } },   // widen role to accept custom names
}),
```

This surfaces `authClient.organization.{createRole,updateRole,deleteRole,
listRoles,getRole}` and widens `member.role` from `"owner"|"admin"|"member"` to
`string`. (The web/CLI consume our own typed `HttpApiClient` for role/grant CRUD,
NOT the better-auth client methods — those exist as a fallback/parity, our
`/api/roles` + `/api/channels/:id/grants` are the canonical management surface.)

### 10b. WEB

- `apps/web/src/routes/_authed/_app/settings/roles.tsx` (NEW): mirror
  `members.tsx`. `createFileRoute("/_authed/_app/settings/roles")` with
  `validateSearch: zodValidator(rolesSearchSchema)` (page/sort in URL search per
  `feedback_router_search_state`). `useSuspenseQuery(rolesQueryOptions(orgId))`.
  Render `RolesTableView` (DataTableView). "Create role" via keyed dialog
  (`feedback_dialog_key_bump_pattern`: parent owns `open`+`resetKey`, keyed child,
  bump key in `onOpenChangeComplete`; cancel button `variant=ghost`).
- `-roles-table.tsx` (NEW): `RolesTableView` mirroring `MembersTableView`; columns
  Name, Permissions (summary chip count), Actions (`Menu`/`MenuPopup`/`MenuItem`,
  edit + destructive delete via `feedback_dialog_menu_trigger_pattern`).
- `-role-form-dialog.tsx` (NEW): permissions editor (resource → action
  checkboxes), coss `Field` with `invalid` prop, `Button loading`. Permission menu
  derived from a resource/action catalog mirroring the server statement.
- `channels/$channelId/grants.tsx` + `-grants-table.tsx` + `-grant-form-dialog.tsx`
  (NEW): mirror the SettingCard layout. `useSuspenseQuery(channelGrantsQueryOptions
(channelId))`. Columns Member, Effect (allow/deny badge), Actions (resource:action
  chips), row actions (edit upsert, destructive revoke). Add-grant dialog upserts
  `{ effect, actions[] }` for a chosen member.
- `queries/org.ts` (EDIT): add `rolesQueryOptions(orgId)` →
  `runApi(() => api.roles.list({ urlParams: { organizationId: orgId } }))`;
  `channelGrantsQueryOptions(channelId)` →
  `runApi(() => api.channelGrants.list({ path: { id: channelId }, urlParams: {} }))`;
  plus `createRole`/`updateRole`/`deleteRole`/`upsertChannelGrant`/
  `deleteChannelGrant` mutation runners (all via typed `HttpApiClient` / `runApi`,
  never raw fetch — `feedback_typed_api_client`).
- `components/settings-layout.tsx` (EDIT): add a "Roles" nav link to
  `/settings/roles`.

All web list/filter state in `validateSearch`; all coss primitives on
`@base-ui/react` (Menu\*/Button loading/Spinner/InputGroup/Field invalid). Data
tables use `lib/data-table` primitives (`feedback_data_table_primitives`).

### 10c. CLI

- `commands/roles/{index,list,create,view,update,delete}.ts` (NEW): mirror
  `commands/channels/` structure exactly — `defineCommand` + `runEffect` +
  `apiClient` + `printList`/`printKeyValue`. `create` args `{ name, permission }`
  where `permission` accepts repeated `resource:action` tokens; `update` args `{ id,
name?, permission? }`; `delete` confirm prompt. All leaves expose global
  `--json`/`--non-interactive` (coverage test walks the registry).
- `command-registry.ts` (EDIT): add `roles: rolesCommand`.
- `commands/channels/grants/{index,list,set,revoke}.ts` (NEW): `list` resolves the
  channel by name (`resolveNamedResourceId` from `channels/helpers.ts`) +
  `api.channelGrants.list`; `set` args `{ channel, member, effect?, actions }` →
  `api.channelGrants.upsert`; `revoke` args `{ channel, member }` →
  `api.channelGrants.delete`. `index` = `defineCommand({ subCommands: { list, set,
revoke } })`.
- `commands/channels/index.ts` (EDIT): add `grants: grantsCommand` to the
  `subCommands` map.

For `--no-` flags use the POSITIVE boolean + `negativeDescription`
(`feedback_citty_negative_flag`).

---

## 11. TEST PLAN

### 11a. Unit — `apps/server/src/auth/access-control.test.ts` (NEW)

Use vitest globals + `@effect/vitest` where Effect is involved. Pure assertions:

1. **Statement superset**: for every resource named in any role of `permissions`,
   `statement[resource]` set-equals the union of that resource's actions across all
   4 roles. Also `statement.team` exists (from `defaultStatements`) and
   `statement.ac` includes `["create","read","update","delete"]`.
2. **Role parity**: `it.each` over `["owner","admin","developer","viewer"]`: for
   each resource, `acRoles[role].statements[resource]` set-equals
   `permissions[role][resource]`; and resources absent from `permissions[role]` are
   absent from `acRoles[role].statements`.
3. **`ac` gating**: `owner`/`admin` have `ac` in statements; `developer`/`viewer`
   do NOT.
4. **`authorize` smoke**: `acRoles.viewer.authorize({ channel: ["read"] }).success
=== true`; `acRoles.viewer.authorize({ channel: ["delete"] }).success === false`.

### 11b. Unit — `apps/server/src/auth/scope.test.ts` (NEW)

Deny-wins truth table. Provide `AuthContext` via `Effect.provideService`
(test-surface §2 pattern) and `EnvironmentGrantRepo` via `Effect.provideService`
with a stub `findForMemberOnScope` returning canned grants. Run
`assertPermissionOn` and assert success (no `Forbidden`) or failure. Matrix
(token = `update:create` on a channel scope):

| memberId       | baseline grants? | deny grant? | allow grant? | expected                           |
| -------------- | ---------------- | ----------- | ------------ | ---------------------------------- |
| set            | yes              | yes         | —            | Forbidden (deny wins)              |
| set            | yes              | no          | —            | OK (baseline)                      |
| set            | no               | no          | yes          | OK (allow grant)                   |
| set            | no               | no          | no           | Forbidden (default deny)           |
| set            | no               | yes         | yes          | Forbidden (deny wins over allow)   |
| set            | yes              | no          | yes          | OK (baseline; allow redundant)     |
| null (api-key) | yes              | (n/a)       | (n/a)        | OK (baseline only; grants ignored) |
| null (api-key) | no               | (any)       | (any)        | Forbidden (baseline only)          |

For the api-key rows, the stub repo MUST assert it is NEVER called (memberId null
short-circuits before the repo yield).

### 11c. Unit — `apps/server/src/auth/permissions.test.ts` (EDIT)

Add `it.each` rows asserting `assertPermission("ac", "create")` succeeds for
`owner`/`admin` and fails (`Forbidden`) for `developer`/`viewer`. Add a row
asserting `assertPermission("ac", "read")` fails for `viewer`.

### 11d. Integration / E2E (e2e-pool) — bootstrap via API, no raw role D1

All use the shared bootstrap (test-surface §6): sign-up → org create → set-active →
invite → email-verify (raw D1 `email_verified=1` is a KEEP workaround) → accept.
Helpers: `setupE2EWorker()` (`tests/helpers/e2e-worker-pool.ts`), `parseCookies`.
Migrations auto-apply via `tests/setup-d1.ts`.

**`apps/server/tests/e2e/roles-flow.test.ts` (NEW)** — built-in + custom roles:

1. Owner invites Bob as `member`? No — built-ins are owner/admin/developer/viewer
   now. Owner invites Bob with `role: "developer"` via
   `POST /api/auth/organization/invite-member` (now accepted — L1). Bob accepts.
2. Assert Bob (developer) can `POST /api/channels` (201) but `DELETE
/api/projects/:id` → 403 (developer lacks `project:delete`).
3. Owner invites Carol as `viewer`; Carol `GET /api/channels` → 200, `POST
/api/channels` → 403.
4. Owner creates a custom role via `POST /api/roles { name: "releaser",
permissions: [{ resource: "channel", actions: ["read","update"] }, { resource:
"rollout", actions: ["read","create","update"] }] }` → 201.
5. Owner assigns "releaser" to Dave (`update-member-role { role: "releaser" }` or
   the better-auth role assignment). Dave can update a channel (200) but `DELETE
/api/channels/:id` → 403.
6. `GET /api/roles` lists "releaser"; non-owner (`viewer` Carol) `GET /api/roles`
   → 403 (`ac:read` denied).

**`apps/server/tests/e2e/channel-grants-flow.test.ts` (NEW)** — per-channel ABAC:

1. Bootstrap owner + project + two channels `staging`, `production`.
2. **Allow grant lets a viewer publish to staging**: invite Eve as `viewer`. Owner
   `PUT /api/channels/{stagingId}/grants/{eveMemberId} { effect: "allow", actions:
["update:create","rollout:update"] }`. Eve publishes an update to `staging`
   (200) but to `production` → 403 (no grant + viewer baseline lacks
   `update:create`).
3. **Deny grant blocks a developer on production**: invite Frank as `developer`
   (baseline allows `update:create`). Owner `PUT
/api/channels/{productionId}/grants/{frankMemberId} { effect: "deny", actions:
["update:create"] }`. Frank publishes to `staging` → 200 (baseline), to
   `production` → 403 (deny wins).
4. **Revoke**: `DELETE /api/channels/{productionId}/grants/{frankMemberId}` →
   Frank can publish to `production` again (200).
5. **Grant management gate**: viewer Eve `PUT …/grants/…` → 403 (lacks
   `member:update`). Only owner/admin manage grants.

**`apps/server/tests/e2e/vault-flow.test.ts` (EDIT, TESTS)** — Section 7: REPLACE
the raw `UPDATE "member" SET "role" = 'developer'` with
`POST /api/auth/organization/update-member-role { memberId, role: "developer",
organizationId }` (now valid via L1). Keep the existing 200/403 assertions.

**`apps/server/tests/e2e/api-key fallback`** — assert (in an existing or new
section of `channel-grants-flow.test.ts`) that an API-key actor publishing to a
channel that has a DENY grant for some member is UNAFFECTED (api keys ignore
grants → publishes 200 if metadata baseline allows), proving the §7 api-key
fallback.

API-key e2e files cap at 120 authed reqs/file (`project_cli_e2e_apikey_ratelimit`)
— keep grant tests under that or split.

---

## 12. FOLLOW-UPS (NOT implemented now)

1. **Env-var-environment scoping.** `env_vars` carry an `environment` enum
   (`development`/`preview`/`production`) — a SEPARATE axis from channels. The
   `environment_grant` table is already generic: extend `scope_kind` CHECK to
   include `'env_var_environment'` (and/or `'branch'`), add a
   `assertPermissionOn("envVar", action, { scopeKind: "env_var_environment",
scopeId })` call in `handlers/env-vars.ts`. Env-vars stay on plain
   `assertPermission` until then.
2. **API-key scoped grants.** v1 api-key principals (`memberId === null`) bypass
   allow/deny grants (baseline only). To scope api keys per channel, give api keys a
   stable principal id (e.g. the api key row id as a synthetic `member_id`, or a new
   `scope_kind`-agnostic `principal_id` column) and extend
   `findForMemberOnScope` to accept a principal kind. Until then, document that
   api-key access is org-wide by metadata.

```

```
