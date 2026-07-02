# IAM Policy + Group Authorization — Authoritative Implementation Spec

Status: AUTHORITATIVE. Supersedes the role/grant model in `SPEC.md` +
`env-grants-SPEC.md` (those two describe the legacy `organization_role` /
`environment_grant` system this spec REPLACES). Implementers follow this EXACTLY.

Toolchain reminders (project rules): `bun`/`bunx` only; `bun run lint` for
lint+typecheck; `bun run format` (oxfmt). Extensionless imports. No `== null`
(`no-eq-null`); truthy / `!x?.y`. `Effect.promise`/`tryPromise` only in
`repositories/` + `cloudflare/*Live`. Handlers no throw — errors are Effect values.
Lint may flake on spurious `no-unsafe-*` "error typed value" — re-run once.

**No backward compat, no data migration.** Prod has zero real users. We DROP
`organization_role` + `environment_grant` and replace the whole authz surface. Do
NOT write backfill SQL.

> **Current implementation state (updated 2026-07-02).** This spec captured the
> original design; the shipped model has since diverged in these ways — the code
> under `apps/server/src/auth/` + the credential handlers is the source of truth:
>
> - **Managed presets:** only `managed:admin` exists. `managed:developer` and
>   `managed:viewer` were removed — fine-grained access is CUSTOM policies. So
>   §1's "admin/developer/viewer" and §5's preset map are obsolete.
> - **Principals:** `PrincipalType = "member" | "group" | "robot"`. There is no
>   `apikey` principal — API keys were replaced by org-owned **robot accounts**.
>   Every `apikey` mention below reads as `robot`.
> - **`assertPermission` is NOT removed** (§11 is wrong on this). It remains the
>   org-level convenience gate (`target = { kind: "org" }`) for genuinely
>   org-scoped resources (member, invitation, policy, group, robotAccount,
>   device, webhook, vault, auditLog, org-shared android keystores/GSA keys).
> - **Credential scoping** (supersedes §2's `project/{projectId}/credential`
>   line, which is RESERVED/inert — no handler produces it):
>   - `appleCredential` → `appleTeam/{APPLE_TEAM_ID}/credential[/{id}]` (10-char
>     portal id; team-less ASC keys under `appleTeam/none`).
>   - `iosBundleConfiguration` / `iosAppMetadata` and Android application
>     identifiers + build-credential groups → `project/{projectId}`.
>   - Android upload keystores + Google service-account keys stay org-level
>     (org-shared secrets).
> - **Escalation guards:** group `addMember`/`removeMember` and policy `detach`
>   are permission-boundary-checked (like `attach` + robot rotate). `assertAccessAny`
>   is deny-aware. Channel/branch/update LIST endpoints filter per-environment so
>   environment-scoped grants see their own items.

---

## 1. Overview + the model

We replace the 3-layer role/grant system with a single **IAM Policy + Group**
model (AWS/GCP shape). Every authorization decision is one Effect gate,
`assertAccess(resource, action, target?)`, evaluated against policies attached —
directly or via groups — to the principal, with **object-scoped** selectors and
**deny-wins, default-deny** resolution.

**Four building blocks:**

- **Policy** — a named, reusable document owned by an org. A document is a list of
  **statements**; each statement = `{ effect: allow|deny, actions: string[],
resources: string[] }`. Stored one-row-per-policy with the document as JSON.
- **Group** — a named collection of members. Policies attach to a group; members of
  the group inherit them.
- **Attachment** — links a policy to a principal: a `member`, a `group`, or an
  `apikey`.
- **Managed presets** — `admin` / `developer` / `viewer` are **virtual** policies
  defined in code (id `managed:admin` etc.), org-wide scope (`*`). They are NOT
  rows — this preserves the zero-query baseline the built-in roles have today and
  avoids duplicating 3 rows per org. Attaching a preset = an attachment row whose
  `policy_id = "managed:admin"`.

**`owner` is NOT a policy.** `member.role === "owner"` stays as a single bootstrap
signal = **root bypass**: unconditional allow-all, NOT subject to deny, cannot be
locked out. Set on the org creator. It is the only remaining use of `member.role`.
Everything else — admin/developer/viewer and all custom access — flows through
policies. `isSuperadmin` (platform admin) bypass is unchanged.

**Resource scoping (path-glob).** A statement's `resources` are hierarchical path
selectors with `*` wildcards. The acted-on object resolves to a canonical path; a
statement applies when an action token matches AND a selector matches the path.
Scopeable resource subtrees: **project, environment/channel, build, credentials,
envVar, submission** (see §2). Org-level resources (member, invitation, billing,
apiKey, auditLog, organization, webhook, device, vaultAccess, IAM-management)
resolve to path `org` and are matched only by `*` / `org` selectors.

**better-auth's role becomes thin.** We stop using `dynamicAccessControl` +
fine-grained `createAccessControl` roles (they cannot express object scope).
better-auth keeps auth/session/membership only. `member.role` keeps just
`owner` (root) vs anything-else (no inherent perms; perms come from policies).
The `creatorRole` stays `"owner"`.

**API-key principals** (`member_id === null`) get policies via
`policy_attachment` rows with `principal_type = "apikey"`, replacing the metadata
permission baseline. No owner bypass for keys.

---

## 2. Canonical resource path tree

Every protected object resolves to ONE canonical path string (segments joined by
`/`). The enforcement site builds it from ids it already holds (parent ids are in
scope at almost every call site — this is the cost of path-glob we accepted).

```
org                                                      # org-level resources
project/{projectId}                                      # project:* + subtree root
project/{projectId}/build/{buildId}                      # build:*
project/{projectId}/credential/{credentialId}            # apple/android/iosBundle credential:*
project/{projectId}/submission/{submissionId}            # submission:*
project/{projectId}/env/{environment}                    # environment axis (branch name)
project/{projectId}/env/{environment}/envVar/{key}       # envVar:*
project/{projectId}/env/{environment}/channel/{channelId}        # channel:*
project/{projectId}/env/{environment}/channel/{channelId}/update/{updateId}    # update:*
project/{projectId}/env/{environment}/channel/{channelId}/rollout/{rolloutId}  # rollout:*
appleTeam/{appleTeamId}/credential/{credentialId}        # appleCredential:* (2026-07-02)
```

Rules:

- **Apple credentials are scoped by APPLE TEAM**, a top-level axis independent of
  projects (added 2026-07-02, `auth/apple-team-access.ts`). `{appleTeamId}` is the
  10-char Apple Team identifier (portal-visible, org-unique), NOT the internal
  `apple_teams.id`. All credential types (distribution/push/pass-type/pay certs,
  push keys, provisioning profiles, ASC API keys) share the single `credential`
  leaf — `appleCredential:*` on selector `appleTeam/{T}` grants full CRUD +
  download for one team; swap the actions list for `["appleCredential:read"]` to
  get a per-team viewer. Team-less ASC keys use the sentinel segment `none`
  (reachable via `appleTeam/*`, never via a specific team). List endpoints filter
  server-side to teams where the actor holds `appleCredential:read` at
  `appleTeam/{T}/credential`.

- **`environment`** is the branch name (`production` / `staging` / `preview` / …).
  A channel is bound to one branch at enforcement time; the handler resolves it.
- **Org-wide env vars** (current `global` sentinel) use the literal project segment
  `global`: `project/global/env/{environment}/envVar/{key}`. Selector
  `project/*/env/production` matches them (`*` matches `global`); to target ONLY
  org-wide vars use `project/global/...`.
- **Listing / org-level reads** (e.g. `project:create`, `member:read`,
  `billing:update`) use path `org`.
- A path is matched by a selector iff the selector, segment-by-segment, is a
  **prefix** of the path with `*` matching exactly one segment (see §5). So
  `project/A` grants on the whole `project/A/...` subtree.

`resolvePath(target)` is a pure helper (§6). `target` is a tagged union
`ObjectRef` (§4) so call sites pass structured ids, not pre-joined strings.

---

## 3. Data model — migrations (CORE)

Next migration numbers after `0056`. Table `iam_group` is prefixed because `group`
is a SQL reserved word; the rest are plain.

### 3a. `0057_drop_legacy_authz.sql`

```sql
-- Replaced by the IAM policy/group model (docs/specs/authz/POLICY-GROUPS-SPEC.md).
-- Prod has zero real users; no data migration.
DROP TABLE IF EXISTS "environment_grant";
DROP TABLE IF EXISTS "organization_role";
```

> better-auth's `organization()` plugin no longer registers `dynamicAccessControl`
> nor the `organizationRole` model (see §11), so dropping `organization_role` is
> safe once `auth.ts` is updated in the same slice.

### 3b. `0058_policy.sql`

```sql
-- A reusable, named permission document. `document` is JSON:
--   { "statements": [ { "effect": "allow"|"deny",
--                       "actions": ["update:create","channel:*","*"],
--                       "resources": ["project/A","project/*/env/production","*"] } ] }
-- Managed presets (admin/developer/viewer) are virtual (code-defined) and are NOT
-- stored here. See POLICY-GROUPS-SPEC.md §1, §5.
CREATE TABLE "policy" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "organization_id" TEXT NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  "name"            TEXT NOT NULL,
  "description"     TEXT,
  "document"        TEXT NOT NULL,
  "created_at"      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "updated_at"      TEXT
);
CREATE INDEX "idx_policy_org" ON "policy" ("organization_id");
CREATE UNIQUE INDEX "idx_policy_org_name" ON "policy" ("organization_id", "name");
```

### 3c. `0059_iam_group.sql`

```sql
CREATE TABLE "iam_group" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "organization_id" TEXT NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  "name"            TEXT NOT NULL,
  "description"     TEXT,
  "created_at"      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "updated_at"      TEXT
);
CREATE INDEX "idx_iam_group_org" ON "iam_group" ("organization_id");
CREATE UNIQUE INDEX "idx_iam_group_org_name" ON "iam_group" ("organization_id", "name");

CREATE TABLE "iam_group_membership" (
  "group_id"   TEXT NOT NULL REFERENCES "iam_group" ("id") ON DELETE CASCADE,
  "member_id"  TEXT NOT NULL REFERENCES "member" ("id") ON DELETE CASCADE,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY ("group_id", "member_id")
);
-- Resolve a member's groups in one indexed read.
CREATE INDEX "idx_iam_group_membership_member" ON "iam_group_membership" ("member_id");
```

### 3d. `0060_policy_attachment.sql`

```sql
-- Links a policy (real row id OR a "managed:*" preset id) to a principal.
CREATE TABLE "policy_attachment" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "organization_id" TEXT NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  "policy_id"       TEXT NOT NULL,   -- "managed:admin" | a policy.id (no FK: managed ids are virtual)
  "principal_type"  TEXT NOT NULL CHECK ("principal_type" IN ('member', 'group', 'apikey')),
  "principal_id"    TEXT NOT NULL,
  "created_at"      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
-- Resolution lookup: every attachment for a principal.
CREATE INDEX "idx_policy_attachment_principal"
  ON "policy_attachment" ("principal_type", "principal_id");
-- Reverse lookup + cascade hygiene on policy delete.
CREATE INDEX "idx_policy_attachment_policy" ON "policy_attachment" ("policy_id");
-- One attachment per (policy, principal).
CREATE UNIQUE INDEX "idx_policy_attachment_unique"
  ON "policy_attachment" ("policy_id", "principal_type", "principal_id");
```

> `policy_id` has no FK because managed preset ids (`managed:*`) are virtual.
> Deleting a real policy must sweep its attachments app-side (§9
> `PolicyRepo.delete` batches a `DELETE FROM policy_attachment WHERE policy_id=?`).
> Deleting a group cascades its memberships (FK) but its `principal_type='group'`
> attachments are swept app-side in `GroupRepo.delete`.

---

## 4. Types + document schema (CORE + CONTRACTS)

### 4a. `apps/server/src/authz-models.ts` (EDIT) — server-side types

`Resource` / `Action` unions are unchanged from today (re-exported via `models.ts`).
Replace the legacy `ScopeKind` / `GrantEffect` / `EnvironmentGrantModel` /
`OrgRoleModel` exports with:

```ts
export type PolicyEffect = "allow" | "deny";

/** A single permission statement inside a policy document. */
export interface PolicyStatement {
  readonly effect: PolicyEffect;
  /** "resource:action" | "resource:*" | "*". */
  readonly actions: readonly string[];
  /** Path-glob selectors: "*", "project/A", "project/*/env/production", … */
  readonly resources: readonly string[];
}
export interface PolicyDocument {
  readonly statements: readonly PolicyStatement[];
}

export interface PolicyModel {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly description: string | null;
  readonly document: PolicyDocument;
  readonly createdAt: string;
  readonly updatedAt: string | null;
}

export interface GroupModel {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly description: string | null;
  readonly createdAt: string;
  readonly updatedAt: string | null;
}

export type PrincipalType = "member" | "group" | "apikey";

export interface PolicyAttachmentModel {
  readonly id: string;
  readonly organizationId: string;
  readonly policyId: string;
  readonly principalType: PrincipalType;
  readonly principalId: string;
  readonly createdAt: string;
}

/** Structured target for assertAccess — resolved to a canonical path by resolvePath. */
export type ObjectRef =
  | { readonly kind: "org" }
  | { readonly kind: "project"; readonly projectId: string }
  | { readonly kind: "build"; readonly projectId: string; readonly buildId: string }
  | { readonly kind: "credential"; readonly projectId: string; readonly credentialId: string }
  | { readonly kind: "submission"; readonly projectId: string; readonly submissionId: string }
  | { readonly kind: "environment"; readonly projectId: string; readonly environment: string }
  | {
      readonly kind: "envVar";
      readonly projectId: string; // "global" for org-wide vars
      readonly environment: string;
      readonly key?: string;
    }
  | {
      readonly kind: "channel";
      readonly projectId: string;
      readonly environment: string;
      readonly channelId: string;
    }
  | {
      readonly kind: "update";
      readonly projectId: string;
      readonly environment: string;
      readonly channelId: string;
      readonly updateId: string;
    }
  | {
      readonly kind: "rollout";
      readonly projectId: string;
      readonly environment: string;
      readonly channelId: string;
      readonly rolloutId: string;
    };
```

### 4b. `packages/api/src/domain/policy.ts` (NEW) — Effect Schema contracts

```ts
export const PolicyEffect = Schema.Literal("allow", "deny");

export const PolicyStatement = Schema.Struct({
  effect: PolicyEffect,
  actions: Schema.Array(Schema.String).pipe(Schema.minItems(1)),
  resources: Schema.Array(Schema.String).pipe(Schema.minItems(1)),
});
export const PolicyDocument = Schema.Struct({ statements: Schema.Array(PolicyStatement) });

export const Policy = Schema.Struct({
  id: Schema.String,
  organizationId: Schema.String,
  name: Schema.NonEmptyString,
  description: Schema.NullOr(Schema.String),
  document: PolicyDocument,
  createdAt: Schema.String,
  updatedAt: Schema.NullOr(Schema.String),
});

export const CreatePolicyBody = Schema.Struct({
  name: Schema.NonEmptyString,
  description: Schema.optional(Schema.String),
  document: PolicyDocument,
});
export const UpdatePolicyBody = Schema.Struct({
  name: Schema.optional(Schema.NonEmptyString),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  document: Schema.optional(PolicyDocument),
});
```

Validate action + selector token shape at the schema boundary where cheap, but the
**authoritative** action-token validation (must reference a real `resource:action`
or a `*` wildcard) lives in the handler against the resource/action vocabulary
(`assertValidActionTokens`, mirrors today's grant handler), since the Schema
package must not import server enums. Selector segment grammar is validated by a
shared pure parser in `packages/api` (see §6) so web/CLI reject bad input early.

`packages/api/src/domain/group.ts` (NEW): `Group`, `CreateGroupBody`,
`UpdateGroupBody`, `GroupMember`, `AddGroupMemberBody`.
`packages/api/src/domain/policy-attachment.ts` (NEW): `PolicyAttachment`,
`AttachPolicyBody { policyId }`, `DetachResult`.

---

## 5. Managed presets (code map) — `apps/server/src/auth/managed-policies.ts` (NEW, CORE)

Virtual, code-defined policies derived from the EXISTING `permissions.ts` maps so
admin/developer/viewer keep today's exact org-wide semantics. Scope `*`.

```ts
export const MANAGED_POLICY_PREFIX = "managed:" as const;
export type ManagedPolicyId = `managed:${"admin" | "developer" | "viewer"}`;

/** Build an allow-all-on-* document from a PermissionMap entry (resource→actions). */
const presetFrom = (perm: Partial<Record<Resource, readonly Action[]>>): PolicyDocument => ({
  statements: Object.entries(perm).map(([resource, actions]) => ({
    effect: "allow",
    actions: (actions as readonly Action[]).map((a) => `${resource}:${a}`),
    resources: ["*"],
  })),
});

export const MANAGED_POLICIES: Record<ManagedPolicyId, PolicyModel> = {
  "managed:admin": virtualPolicy("managed:admin", "Admin", presetFrom(permissions.admin)),
  "managed:developer": virtualPolicy(
    "managed:developer",
    "Developer",
    presetFrom(permissions.developer),
  ),
  "managed:viewer": virtualPolicy("managed:viewer", "Viewer", presetFrom(permissions.viewer)),
};

export const isManagedPolicyId = (id: string): id is ManagedPolicyId =>
  id.startsWith(MANAGED_POLICY_PREFIX) && id in MANAGED_POLICIES;

/** Resolve a policy_id (managed virtual OR real) → document. Real ids hit the repo. */
export const resolveManagedDocument = (id: string): PolicyDocument | null =>
  isManagedPolicyId(id) ? MANAGED_POLICIES[id].document : null;
```

`permissions.owner` is NOT turned into a managed policy — owner is the
`member.role` root bypass (§7). `permissions.ts` itself stays as the source for
preset contents; `assertPermission`/`assertPermissionOn`/`assertSuperadmin` are
removed/replaced (§7, §9). The `ac` resource is renamed conceptually to the
IAM-management surface and stays org-level (`policy:*`/`group:*` actions, §9).

---

## 6. Pure matchers — `apps/server/src/auth/policy-match.ts` (NEW, CORE; pure, unit-tested)

No I/O, no Effect services — pure functions. Mirror the selector grammar in a
shared `packages/api` helper so web/CLI validate identically (import the package
one, re-export; do NOT duplicate the algorithm — `feedback_shared_code_packages`).

```ts
/** "update:create" matches token list ["update:*"] / ["*"] / exact. */
export const actionMatches = (statementActions: readonly string[], action: string): boolean => {
  const [res] = action.split(":");
  return statementActions.some((a) => a === "*" || a === action || a === `${res}:*`);
};

/**
 * Segment-prefix match with `*` wildcard.
 *   selectorMatches("project/A", "project/A/env/E1/...") === true
 *   selectorMatches("project/*\/env/production", "project/B/env/production") === true
 *   selectorMatches("*", anything) === true
 *   selectorMatches("project/A", "org") === false
 */
export const selectorMatches = (selector: string, path: string): boolean => {
  if (selector === "*") return true;
  const sel = selector.split("/");
  const seg = path.split("/");
  if (sel.length > seg.length) return false; // selector deeper than target → no
  return sel.every((s, i) => s === "*" || s === seg[i]);
};

/** ObjectRef → canonical path (§2). Pure. */
export const resolvePath = (ref: ObjectRef): string => {
  switch (ref.kind) {
    case "org":
      return "org";
    case "project":
      return `project/${ref.projectId}`;
    case "build":
      return `project/${ref.projectId}/build/${ref.buildId}`;
    case "credential":
      return `project/${ref.projectId}/credential/${ref.credentialId}`;
    case "submission":
      return `project/${ref.projectId}/submission/${ref.submissionId}`;
    case "environment":
      return `project/${ref.projectId}/env/${ref.environment}`;
    case "envVar":
      return `project/${ref.projectId}/env/${ref.environment}/envVar/${ref.key ?? ""}`;
    case "channel":
      return `project/${ref.projectId}/env/${ref.environment}/channel/${ref.channelId}`;
    case "update":
      return `project/${ref.projectId}/env/${ref.environment}/channel/${ref.channelId}/update/${ref.updateId}`;
    case "rollout":
      return `project/${ref.projectId}/env/${ref.environment}/channel/${ref.channelId}/rollout/${ref.rolloutId}`;
  }
};
```

> For list/`*` reads on envVar (no `key`), `resolvePath` yields a trailing-slash
> path; an `envVar:read` selector of `project/A/env/production` is a prefix and
> matches — correct. Empty-key paths never need an exact channel/update match.

---

## 7. Evaluator + gate — `apps/server/src/auth/policy.ts` (NEW, CORE)

Replaces `auth/scope.ts` (deleted) and the gates in `auth/permissions.ts`.
Resolution is **deny-wins, default-deny**, with `superadmin` + `owner` bypass.

```ts
export const assertAccess = (
  resource: Resource,
  action: Action,
  target: ObjectRef = { kind: "org" },
): Effect.Effect<void, Forbidden, CurrentActor> =>
  Effect.gen(function* () {
    const actor = yield* CurrentActor;
    if (actor.isSuperadmin) return; // platform admin
    if (actor.isOwner) return; // org root: allow-all, undeniable
    const token = `${resource}:${action}`;
    const path = resolvePath(target);
    const stmts = actor.effectiveStatements.filter(
      (s) => actionMatches(s.actions, token) && s.resources.some((r) => selectorMatches(r, path)),
    );
    if (stmts.some((s) => s.effect === "deny")) return yield* Effect.fail(forbidden(token, path));
    if (stmts.some((s) => s.effect === "allow")) return;
    return yield* Effect.fail(forbidden(token, path)); // default deny
  });
```

`CurrentActor` (auth context, §8) gains:

- `isOwner: boolean` — `member.role === "owner"` (member principals only).
- `effectiveStatements: readonly PolicyStatement[]` — flattened, pre-resolved once
  per request (built-in `effectivePermissions` map is removed).

`forbidden(token, path)` returns the existing `Forbidden` Effect error, message
includes both the action token and the path for debuggability (no resource leak —
path uses ids the caller already supplied).

---

## 8. Middleware resolution — `apps/server/src/auth/middleware.ts` (EDIT, CORE)

Replace `resolveEffectivePermissions` (built-in/custom role merge) with
`resolveEffectiveStatements`. Resolution runs ONCE per request and is cached into
`CurrentActor`. Cost: 2 reads (group memberships + attachments) for member
principals; 1 read (attachments) for api-key principals; managed presets resolve
from the code map with no query.

```ts
const resolveEffectiveStatements = (principal): Effect.Effect<readonly PolicyStatement[], never, …> =>
  Effect.gen(function* () {
    if (principal.isOwner) return [];          // owner bypasses; statements unused
    const attachRepo = yield* PolicyAttachmentRepo;
    const groupRepo = yield* GroupRepo;
    const policyRepo = yield* PolicyRepo;

    // principal ids whose attachments apply: self + groups (members) or just self (apikey)
    const principals =
      principal.kind === "member"
        ? [
            { type: "member", id: principal.memberId },
            ...(yield* groupRepo.findGroupIdsForMember({ memberId: principal.memberId })).map(
              (id) => ({ type: "group", id }) as const,
            ),
          ]
        : [{ type: "apikey", id: principal.apiKeyId }];

    const attachments = yield* attachRepo.findForPrincipals({ organizationId, principals });
    const policyIds = dedupe(attachments.map((a) => a.policyId));

    // Split managed (code) vs real (repo). One batched read for real ids.
    const realIds = policyIds.filter((id) => !isManagedPolicyId(id));
    const realDocs = yield* policyRepo.findDocumentsByIds({ organizationId, ids: realIds });
    return policyIds.flatMap((id) => {
      const doc = isManagedPolicyId(id) ? resolveManagedDocument(id) : realDocs.get(id) ?? null;
      return doc?.statements ?? [];
    });
  });
```

`member.role` is read once (as today) to set `isOwner`. The legacy multi-role
comma-split + `OrgRoleRepo.findByName` path is deleted. `isRole` / built-in
whitelist logic is removed. API-key principals carry `apiKeyId` (the better-auth
key id) as their attachment principal id; the legacy `key.permissions ??
permissions.admin` metadata fallback is removed — a key with no attachments has NO
permissions (default-deny). Seed a default attachment when issuing a key if a
baseline is desired (handler decision, document in §9).

---

## 9. Repos + handlers

### 9a. Repos (CORE) — `repositories/policy-repo.ts`, `group-repo.ts`, `policy-attachment-repo.ts`

Port + colocated D1 `Live`, JSON `document` decoded via Effect Schema in `toModel`.
Key methods (all `Effect.Effect`, tenant-scoped by `organizationId`):

- **PolicyRepo**: `list`, `findById`, `findDocumentsByIds({ ids }) → Map<id, PolicyDocument>`,
  `create`, `update`, `delete` (batches `DELETE FROM policy_attachment WHERE policy_id=?`).
- **GroupRepo**: `list`, `findById`, `create`, `update`, `delete` (batches attachment +
  membership sweep), `findGroupIdsForMember({ memberId }) → string[]`,
  `listMembers({ groupId })`, `addMember`, `removeMember`.
- **PolicyAttachmentRepo**: `findForPrincipals({ principals }) → PolicyAttachmentModel[]`
  (one `WHERE (principal_type, principal_id) IN (...)` — mind D1's compound limits;
  members rarely exceed a handful of groups, but chunk if needed,
  `project_d1_compound_select_limit`), `listForPrincipal`, `attach` (insert,
  `ON CONFLICT DO NOTHING`), `detach`, `deleteByPolicy`.

Register all three `Live` + drop `EnvironmentGrantRepoLive` / `OrgRoleRepoLive` in
`infrastructure-layer.ts`.

### 9b. Handlers (HANDLERS) — management endpoints

New `HttpApiBuilder.group` handlers, all gated by `assertAccess` on an
**IAM-management** resource (org-level). Use a `policy` + `group` Resource (replaces
`ac`); only owner/admin-equivalent policies grant `policy:*` / `group:*`.

- `handlers/policies.ts` — `PoliciesGroupLive`: CRUD `/api/policies`. Managed
  presets are surfaced read-only (list merges `MANAGED_POLICIES`); create/update/
  delete reject `managed:*` ids. `assertValidActionTokens` validates each
  statement's action tokens against the resource/action vocabulary (mirror the
  legacy grant handler) and selector grammar via the shared parser.
- `handlers/groups.ts` — `GroupsGroupLive`: CRUD `/api/groups` + members
  (`/api/groups/:id/members`). Members validated same-org via `MemberRepo.findOrgId`.
- `handlers/policy-attachments.ts` — attach/detach `/api/members/:id/policies`,
  `/api/groups/:id/policies`, `/api/api-keys/:id/policies`. Validates the policy id
  (managed or same-org real) + the principal belongs to the org.

Gate for all three: `assertAccess("policy"|"group", action)` (org target). Owner
bypass guarantees the creator can always bootstrap IAM.

### 9c. Handlers — enforcement conversion (HANDLERS)

Replace EVERY `assertPermission(resource, action)` and
`assertPermissionOn(resource, action, scope)` call with
`assertAccess(resource, action, target)`:

| Surface                                                             | Old                           | New target                                               |
| ------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------- | ------------------------------ |
| org-level (member/billing/apiKey/auditLog/org/webhook/device/vault) | `assertPermission`            | `{ kind: "org" }`                                        |
| project read/create/update/delete                                   | `assertPermission`            | `{ kind: "project", projectId }` (create → `org`)        |
| channel mutations + channel↔branch                                  | `assertPermissionOn(channel)` | `{ kind: "channel", projectId, environment, channelId }` |
| publish / republish to channel                                      | `assertPermissionOn`          | `{ kind: "update", … }` (or `channel` for the gate)      |
| rollout create/update                                               | `assertPermissionOn`          | `{ kind: "rollout", … }`                                 |
| envVar read/mutate                                                  | `assertPermission`            | `{ kind: "envVar", projectId                             | "global", environment, key? }` |
| build trigger/read/cancel                                           | `assertPermission`            | `{ kind: "build", projectId, buildId? }`                 |
| credentials read/download                                           | `assertPermission`            | `{ kind: "credential", projectId, credentialId? }`       |
| submission                                                          | `assertPermission`            | `{ kind: "submission", projectId, submissionId? }`       |

Most sites already hold `projectId` + `channelId`; resolve `environment` from the
branch the channel maps to (`ChannelRepo.findByBranchId` / branch lookup already
used by the legacy rollout gate). Where only a channel id is known, do ONE parent
lookup to build the ref. Keep `assertOrgOwnership` / `assertProjectOwnership`
(tenant 404 guards) unchanged — they are orthogonal to policy evaluation.

`assertSuperadmin` stays for `/api/admin/*`.

---

## 10. API contracts (CONTRACTS — `packages/api`)

- `domain/policy.ts`, `domain/group.ts`, `domain/policy-attachment.ts` (§4b).
- `groups/policies.ts` → `PoliciesGroup` (`/api/policies`).
- `groups/groups.ts` → `GroupsGroup` (`/api/groups`, `/api/groups/:id/members`).
- `groups/policy-attachments.ts` → `/api/members/:id/policies`,
  `/api/groups/:id/policies`, `/api/api-keys/:id/policies`.
- `api.ts` EDIT: `.add(PoliciesGroup).add(GroupsGroup).add(PolicyAttachmentsGroup)`;
  REMOVE `OrgRolesGroup` + `ChannelGrantsGroup`.
- `auth/context.ts` EDIT: drop `effectivePermissions`/`Role` role-spec; add
  `isOwner` + `effectiveStatements` to `AuthContextShape`. Add `policy` + `group`
  to `Resource`; remove `ac`.
- Shared selector-grammar validator lives here (re-used by web/CLI/server §6).

`packages/auth-client/src/index.ts` EDIT: remove `dynamicAccessControl` +
`inferAdditionalFields` role plumbing tied to the old model (keep `member.role`
string field for owner display).

---

## 11. better-auth wiring (CORE) — `apps/server/src/auth.ts` (EDIT)

- Remove `dynamicAccessControl`, the `ac`/`roles: acRoles` registration, and the
  `organizationRole` snake_case model map from `organization()`.
- Keep `creatorRole: "owner"`. `member.role` remains a free string but the app only
  distinguishes `"owner"` (root) from everything else.
- Delete `auth/access-control.ts` (statement/role derivation) — no longer used.
  `auth/permissions.ts` is kept ONLY as the preset-content source for
  `managed-policies.ts`; its `assert*` exports are removed.

---

## 12. Web (WEB — `apps/web`)

Replace the `/roles` route with two top-level routes (mirror the recent move to
top-level `/roles`):

- **`/policies`** — `routes/_authed/_app/policies.tsx` + `-policies-table.tsx` +
  `-policy-form-dialog.tsx`. The form is a **policy builder**: repeatable statement
  rows (effect select; actions multi-select from the resource/action vocabulary
  with `*`/`resource:*` options; resources = selector builder with project /
  environment / channel pickers feeding path-glob strings). Managed presets show
  read-only with a lock badge.
- **`/groups`** — `routes/_authed/_app/groups.tsx` + `-groups-table.tsx` +
  `-group-form-dialog.tsx` + members sub-view.
- **Member detail** — show attached policies + group membership; attach/detach UI.

All list state via TanStack Router `validateSearch` (`feedback_router_search_state`);
list views use shared `lib/data-table` primitives (`feedback_data_table_primitives`);
coss canonical components + dialog patterns (`feedback_dialog_*`,
`project_coss_canonical_names`). Queries via the typed `runApi()` client
(`feedback_typed_api_client`) in `queries/policy.ts`, `queries/group.ts` (replace
`queries/org.ts` role/grant query options). Credentials/env-var grant UIs from the
legacy model are removed.

## 13. CLI (CLI — `apps/cli`, parity only if needed)

`better-update policies` + `better-update groups` command groups (list/create/
update/delete/attach/detach), reusing the typed client. Mind CLI e2e api-key
rate-limit + 1-key-per-file rules (`project_cli_e2e_apikey_ratelimit`).

---

## 14. Tests (TESTS)

- **Unit (pure)** `auth/policy-match.test.ts`: truth tables for `actionMatches`
  (`*`, `resource:*`, exact, miss), `selectorMatches` (prefix, wildcard segment,
  too-deep selector, `org` vs `project/*`, global-envvar), `resolvePath` (every
  `ObjectRef` kind).
- **Unit (pure)** `auth/policy.test.ts` via `@effect/vitest` `it.effect`: evaluator
  deny-wins / default-deny / owner bypass / superadmin bypass / allow-via-group vs
  deny-direct (deny wins) — provide `CurrentActor` via `Effect.provideService`, no
  mocks.
- **Integration** (vitest-pool-workers, real D1): policy/group/attachment repos +
  resolution path (member in 2 groups, managed + real policy mix).
- **E2E** (`project_e2e_pool_workers`): cross-flow — create policy scoped to
  `project/A`, attach to a group, add a member, assert that member can mutate a
  channel in project A but is denied in project B; owner is never locked out;
  api-key with no attachment is denied. Web e2e: policy builder + group membership
  happy path (mind base-ui toast/dialog role gotchas,
  `project_e2e_baseui_toast_dialog_role`). Do NOT auto-run server e2e
  (`feedback_e2e_long_running`) — gate on lint + unit.

Do NOT test framework built-ins (`feedback_no_framework_tests`): no tests for
Effect Schema decode of the document itself, only our matching/resolution logic.

---

## 15. File ownership (slices — implement in parallel)

| Slice         | Files                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CORE**      | migrations `0057`–`0060`; `auth/policy.ts`, `auth/policy-match.ts`, `auth/managed-policies.ts` (NEW); `auth/middleware.ts`, `auth.ts`, `authz-models.ts`, `models.ts` (EDIT); DELETE `auth/scope.ts`, `auth/access-control.ts`, gates in `auth/permissions.ts`; `repositories/policy-repo.ts`, `group-repo.ts`, `policy-attachment-repo.ts` (NEW); DELETE `environment-grant-repo.ts`, `org-role-repo.ts`; `infrastructure-layer.ts` (EDIT) |
| **CONTRACTS** | `packages/api` `domain/policy.ts`, `domain/group.ts`, `domain/policy-attachment.ts`, `groups/policies.ts`, `groups/groups.ts`, `groups/policy-attachments.ts` (NEW); `api.ts`, `auth/context.ts` (EDIT); DELETE legacy `org-role`/`channel-grant` domain+groups; `packages/auth-client` (EDIT)                                                                                                                                              |
| **HANDLERS**  | `handlers/policies.ts`, `groups.ts`, `policy-attachments.ts` (NEW); DELETE `org-roles.ts`, `channel-grants.ts`, `env-grants.ts`; convert `channels.ts`, `updates.ts`, `update-republish.ts`, env-var/build/credential/submission handlers to `assertAccess`; `handlers/index.ts`, `app-layer.ts` (EDIT)                                                                                                                                     |
| **WEB**       | `routes/_authed/_app/policies.tsx` + `groups.tsx` (+ `-*` children) (NEW); DELETE `roles.tsx` + `-roles-*`; `queries/policy.ts`, `group.ts` (NEW), `queries/org.ts` (EDIT); member detail attach UI                                                                                                                                                                                                                                         |
| **CLI**       | `commands/policies/*`, `commands/groups/*` (NEW); DELETE legacy role/grant commands                                                                                                                                                                                                                                                                                                                                                         |
| **TESTS**     | as §14                                                                                                                                                                                                                                                                                                                                                                                                                                      |

CORE owns `infrastructure-layer.ts`; HANDLERS owns `app-layer.ts` +
`handlers/index.ts`. They never overlap.

---

## 16. Verification

1. `bun run lint` (lint + typecheck; re-run once on spurious `no-unsafe-*`).
2. `bun run test` (unit + coverage; `auth/` pure matchers + evaluator must hit the
   80% gate — they are in `src/auth/`, an in-scope coverage dir).
3. `bun run test:integrations` (repos + resolution).
4. `bun run test:e2e` MANUALLY (not auto) for the cross-flow journeys.
5. `bun run format` (oxfmt).

No `// eslint-disable` without a framework-exception reason. No new top-level dir
under `apps/server/src/`. Stop + ask before adding any "application service" class
layer or a new scope axis not in §2.
