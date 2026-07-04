# Two-Axis Roles + Capabilities — Authorization UX Spec

Status: FULLY SUPERSEDED (2026-07-03) by `GITLAB-RBAC-SPEC.md` — the whole
policy/statement substrate was removed (migrations 0086–0090); the
protected-environment guard and the `/api/me` capability contract survive
there in role-based form. Kept for history only. Earlier status:
PARTIALLY SUPERSEDED (2026-07-02, same day as implementation). The
project-role vocabulary (`managed:{maintainer|developer|viewer}@{scope}`) and
the capabilities (`managed:cap-*`) were REMOVED by user decision — the ONLY
managed policy is `managed:admin`; all finer-grained access is granted via
CUSTOM policies. Migrations 0083/0084 dropped the removed ids' attachment +
invitation-grant rows. What REMAINS in force from this spec: the protected-env
guard (§2d), the restored OTA env path grammar, the member baseline, the
`/api/me` capability contract, access summaries (simplified to org role +
custom count), invitation grants plumbing, and server-side project-list
filtering. §2b/§2c/§4a/§7/§9b-c/§10 are historical.

Original status: AUTHORITATIVE for the role/UX layer — IMPLEMENTED (2026-07-02). This
spec BUILDS ON the engine in `POLICY-GROUPS-SPEC.md` (statements, path-glob
selectors, deny-wins default-deny `assertAccess`, permission boundary). Two
engine-adjacent changes landed with it (see §2d/§4):

1. The OTA axis regained its `env/{environment}` path segment (restoring the
   original POLICY-GROUPS grammar): `project/{id}/env/{E}/channel/{id}/…`,
   where `E` is the channel/branch NAME. Channel-axis `ObjectRef`s carry
   `environment`; handlers pass the channel name (or branch name for
   branch-only targets).
2. Protected environments are enforced by a GUARD inside `assertAccess`, not
   by enumerated per-environment ALLOW statements (the spec's original
   compile-time template could not work: channel/branch names are an OPEN set
   — publishes auto-create arbitrarily named branches/channels — so
   "every non-protected env" cannot be enumerated).

Toolchain reminders (project rules): `bun`/`bunx` only; `bun run lint` for
lint+typecheck; `bun run format` (oxfmt). Extensionless imports. No `== null`;
truthy / `!x?.y`. `Effect.promise`/`tryPromise` only in `repositories/` +
`cloudflare/*Live`. Handlers never throw — errors are Effect values. Lint may
flake on spurious `no-unsafe-*` — re-run once.

**DB compat stays (additive migrations, no drops), but managed-policy
semantics change IN PLACE** — accepted decision. Existing bare
`managed:developer` / `managed:viewer` attachments become aliases for the new
`@*` project roles (§7): holders silently LOSE the org-shared grants those
presets used to carry (credentials, audit log, webhooks, `project:create`).
Re-grant capabilities per person after deploy where still wanted.

---

## 1. Problems this fixes

Observed on the live UI (2026-07-02 review) + the current permission maps
(`apps/server/src/auth/permissions.ts`):

1. **Roles are single-axis and org-wide.** `managed:developer` compiles to
   `resources: ["*"]` — granting Developer grants every project, every
   environment. The engine supports path scoping; the product never exposes it
   except via the raw policy builder.
2. **Sensitive org-shared resources are bundled into daily-work roles.**
   Developer today: org-wide `appleCredential`/`androidCredential`
   read+create+update+**download**, `vaultAccess:read`, `device` CRU, org-wide
   `auditLog:read`, `webhook` write, `submission:cancel`. Viewer today: reads
   members, policies, groups, audit log, credential metadata, env-var keys.
3. **The only tuning tool is the AWS-style policy builder** (flat token
   dropdown, hand-typed path globs, "18 statements" lists). Right as an escape
   hatch, wrong as the primary UX.
4. **UI is not permission-aware**: sidebar shows all admin pages to everyone;
   the members table shows better-auth `Owner|Member` while real access lives in
   per-member dialogs; managed presets render with zero description.
5. **`authClient.organization.listMembers` bypasses IAM** — any org member can
   read the member directory regardless of `member:read`. §8 makes this an
   explicit, documented decision instead of an accident.

Constraint that shapes everything: **the vault is zero-knowledge**
(`project_e2e_credential_vault`). There is no "use the cert without reading it"
permission — anyone who builds locally must decrypt. The real gate for secrets
is vault membership (key wraps), not the permission token; tokens only stop the
server from returning ciphertext+metadata. Therefore credential access must be
an explicit, auditable, vault-linked grant — not a default in a work role.

---

## 2. The model

Three layers, all compiling to the existing statement engine:

```
Layer 1  Org role        owner (root bypass) | admin (managed:admin) | member (baseline)
Layer 2  Project role    maintainer | developer | viewer   × scope (one project | all projects)
         Capabilities    credentials | auditor | billing   (org-wide add-on grants)
Layer 3  Custom policies (existing builder — unchanged, demoted to "Advanced")
```

### 2a. Org roles

| Role       | Mechanism                        | Grants                                                                                                                                                                    |
| ---------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Owner**  | `member.role === "owner"`        | root bypass, unchanged                                                                                                                                                    |
| **Admin**  | attach `managed:admin`           | unchanged — full current `permissions.admin` map (members, invitations, IAM, projects, credentials, vault, robots, billing, webhooks, audit, environments)                |
| **Member** | implicit baseline, no attachment | `organization:read` + `environment:read` on `org` only (environment NAMES are org-structural metadata every project surface renders). Joining an org grants nothing else. |

The member baseline is compiled in code during statement resolution (one
constant statement appended for `kind === "member"` principals) — NOT an
attachment row. Robots get no baseline (unchanged: no attachments = no access).

### 2b. Project roles — parameterized managed policies

New managed-policy id grammar (extends `managed:{name}`):

```
managed:{maintainer|developer|viewer}@{projectId}   one project
managed:{maintainer|developer|viewer}@*             all projects (current + future)
```

An attachment row's `policy_id` stores the full parameterized id (the
`policy_attachment` table is unchanged — `policy_id` is already FK-less TEXT).
Attachable to `member`, `group`, and `robot` principals alike.

Role → permission map (path-scoped; `root` = `project/{id}` or `project/*`):

| Resource   | Maintainer                   | Developer                                  | Viewer |
| ---------- | ---------------------------- | ------------------------------------------ | ------ |
| project    | read, update                 | read                                       | read   |
| branch     | read, create, update, delete | read, create                               | read   |
| channel    | read, create, update, delete | read + create/update on non-protected envs | read   |
| update     | read, create, delete         | read + create/delete on non-protected envs | read   |
| rollout    | read, create, update, delete | read + create/update on non-protected envs | read   |
| envVar     | read, create, update, delete | read + create/update on non-protected envs | —      |
| build      | read, create, delete         | read, create                               | read   |
| submission | read, create, update, cancel | read                                       | read   |

Deliberate exclusions (tightenings vs today's Developer/Viewer — call out in
the changelog):

- **No org-shared resources in any project role**: no `appleCredential` /
  `androidCredential` / `iosBundleConfiguration` / `iosAppMetadata` /
  `vaultAccess` / `device` (→ Credentials capability), no `auditLog`
  (→ Auditor capability), no `webhook` / `robotAccount` (→ Admin), no
  `member` / `policy` / `group` / `organization` reads (→ baseline/Admin).
- **No `project:create` in any project role** (today Developer has it
  org-wide). Creating projects is Admin+. Project roles are grants ON existing
  projects.
- **Org-wide env vars** (`project/global/...` paths) are NOT matched by
  project-role selectors (`project/{id}` never matches `project/global`;
  `project/*` does match it — see compiler note §4c). Managing global vars is
  Admin+.
- Viewer loses env-var key visibility entirely (today it has org-wide
  `envVar:read`).

### 2c. Capabilities — org-wide add-on grants

Static managed policies, org-scoped, attachable to any principal type:

| Id                        | Name                | Document (all selectors `["*"]`)                                                                                                                                    |
| ------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `managed:cap-credentials` | Credentials manager | `appleCredential:*` (incl. download), `androidCredential:*`, `iosBundleConfiguration:*`, `iosAppMetadata:*`, `device:read/create/update/delete`, `vaultAccess:read` |
| `managed:cap-auditor`     | Auditor             | `auditLog:read`                                                                                                                                                     |
| `managed:cap-billing`     | Billing manager     | `billing:read`, `billing:update`                                                                                                                                    |

Notes:

- **Credentials is the vault-coupled capability.** Granting it is the "on
  paper" half; the crypto half is vault membership (admin grant / device
  enrollment — existing flows). The UI must surface both together (§9c). A dev
  who needs local iOS builds needs this capability — that is the point: it
  becomes an explicit, audited decision instead of a Developer default.
- `vaultAccess:read` stays out of Viewer/Developer for the same escalation
  reason documented in `permissions.ts` today.
- Apple test devices live here (org-scoped resource, affects org-wide
  provisioning profiles). Self-service device registration for non-capability
  holders is OUT of scope (future: a `device:self` action).

### 2d. Protected environments

GitLab-protected-branches analogue, replacing hand-written
`project/*/env/production` globs for the common case:

- An environment can be **protected** per org. Default: `production` is
  protected in every org (existing and new).
- Effect: **Developer write statements are only emitted for non-protected
  environments** (§4c). Maintainer+ writes everywhere in scope. Reads are
  unaffected.
- Managed in Organization settings (Admin+), toggle per environment (built-in
  and custom).

**Protection is an allow-CONJUNCTION (the protected-env guard), never a DENY
statement.** A deny would poison composition: deny-wins means `developer@*`
(deny prod) + `maintainer@projectA` (allow prod) would leave the maintainer
locked out of project A's production. Implementation: `assertAccess`
(auth/policy.ts) runs a guard after the base allow — any WRITE whose target
carries an `environment` that is in the org's `protected_environment` set
additionally requires `environment:update` on `project/{id}/env/{E}`.
Maintainer holds that token at its project root; developer does not; a custom
policy can grant a targeted override (e.g. `environment:update` on
`project/*/env/production` = "production publisher"). The guard reads the
protected set per write request, so a newly-(un)protected environment is picked
up immediately, and it works for arbitrarily named channels/branches (an
unprotected name simply never matches the set).

---

## 3. Data model — migrations (CORE)

Next numbers after `0080`. Additive only.

### 3a. `0081_protected_environment.sql`

Built-in environments are VIRTUAL (no rows — see `0061`), so protection cannot
be a column on `environments`. A row in this table = that environment name is
protected in that org.

```sql
-- Protected environments (docs/specs/authz/ROLES-CAPABILITIES-SPEC.md §2d).
-- Presence of a row = protected. Works for built-in (virtual) and custom
-- environment names alike. Unprotecting deletes the row.
CREATE TABLE "protected_environment" (
  "organization_id" TEXT NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  "environment"     TEXT NOT NULL,
  "created_at"      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY ("organization_id", "environment")
);

-- Default: production is protected everywhere.
INSERT INTO "protected_environment" ("organization_id", "environment")
  SELECT "id", 'production' FROM "organization";
```

Org bootstrap (the code path that forks the env vault / seeds defaults) also
inserts the `production` row for new orgs.

### 3b. `0082_invitation_grant.sql`

Invitations must carry intended access so the inviter picks it up front and the
acceptor lands with the right grants (no post-accept manual step).

```sql
-- Access grants applied when an invitation is accepted
-- (docs/specs/authz/ROLES-CAPABILITIES-SPEC.md §8d). policy_id follows the
-- same grammar as policy_attachment.policy_id (managed, parameterized managed,
-- or real policy id). Rows are consumed (deleted) on accept.
CREATE TABLE "invitation_grant" (
  "invitation_id"   TEXT NOT NULL,
  "organization_id" TEXT NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  "policy_id"       TEXT NOT NULL,
  "created_at"      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY ("invitation_id", "policy_id")
);
```

No FK to better-auth's `invitation` table (its lifecycle is plugin-managed);
sweep rows app-side on invitation cancel/expiry handling and on accept.

---

## 4. Managed-policy compiler (CORE) — `apps/server/src/auth/managed-policies.ts` (EDIT)

### 4a. Id grammar + parsing

```ts
export type ProjectRoleName = "maintainer" | "developer" | "viewer";
export type CapabilityName = "cap-credentials" | "cap-auditor" | "cap-billing";

// managed:admin                                             (org role)
// managed:developer | managed:viewer | managed:maintainer   (bare → alias of @* — §7)
// managed:cap-*                                             (capabilities)
// managed:{maintainer|developer|viewer}@{projectId|*}       (project roles)
export interface ParsedManagedId {
  readonly base: "admin" | "developer" | "viewer" | ProjectRoleName | CapabilityName;
  readonly scope?: string; // projectId or "*" — present iff parameterized
}
export const parseManagedId = (id: string): ParsedManagedId | null => {
  /* pure */
};
```

`isManagedPolicyId` accepts anything `parseManagedId` accepts. Reject malformed
scopes at attach time (handler validation §8a): scope must be `*` or an
existing same-org project id.

### 4b. Resolution — static, zero-read

Project-role documents are STATIC per (role, scope): the protected-env guard
(§2d) carries all environment-awareness, so `resolveManagedDocument(id)` needs
no resolution context and `statements.ts` keeps its zero-extra-read cost for
every id kind. The only per-request read protection adds is one
`protected_environment` lookup inside `assertAccess`, and only for WRITES on
environment-carrying targets.

### 4c. Statement templates

`root(scope)` = `project/${scope}` (also when scope is `*` — the selector
`project/*` never matches the `org` path, so parameterized roles can never leak
org-level grants; it DOES match `project/global` env-var paths: accepted for
`@*` maintainer/developer on non-protected envs. Global PROTECTED vars stay
guarded — developer@_ lacks `environment:update`; note maintainer@_ holds it
and can therefore write protected GLOBAL vars too, accepted as near-admin).

```ts
// maintainer@S — one root statement; tokens are ENUMERATED concretely (never
// `resource:*`) so the attach-time permission boundary can subsume them from
// the enumerated admin/owner maps. Includes environment:update = the
// protected-env override token.
[
  { effect: "allow",
    actions: [/* project r/u, branch/channel/update/rollout/envVar CRUD,
                 build r/c/d, submission r/c/u/cancel, environment:update */],
    resources: [root(S)] },
]

// developer@S — reads at root; writes on the env subtree (ALL envs — the
// protected-env guard blocks protected ones at request time)
[
  { effect: "allow",
    actions: ["project:read","branch:read","branch:create","channel:read",
              "update:read","rollout:read","envVar:read",
              "build:read","build:create","submission:read"],
    resources: [root(S)] },
  { effect: "allow",
    actions: ["channel:create","channel:update","update:create","update:delete",
              "rollout:create","rollout:update","envVar:create","envVar:update"],
    resources: [`${root(S)}/env/*`] },
]

// viewer@S
[
  { effect: "allow",
    actions: ["project:read","branch:read","channel:read","update:read",
              "rollout:read","build:read","submission:read"],
    resources: [root(S)] },
]
```

Source maps: `projectRolePermissions` (rootActions/envWriteActions) +
`capabilityPermissions` in `auth/permissions.ts`.

Capabilities + admin are static docs from plain permission maps (same
`presetFrom` shape as today, selectors `["*"]`).

New source maps live in `permissions.ts`:
`projectRolePermissions: Record<ProjectRoleName, …>` split into
`rootActions` / `envWriteActions`, and
`capabilityPermissions: Record<CapabilityName, …>`. The existing
`permissions.developer` / `permissions.viewer` maps are DELETED (§7 — bare ids
alias the new `@*` roles). `permissions.admin` and `permissions.owner` are
unchanged.

### 4d. Permission boundary

`isWithinBoundary` operates on resolved statements — parameterized docs resolve
before the check, so attach-time boundary enforcement
(`handlers/policy-attachments.ts`) works unchanged.

---

## 5. Enforcement additions (CORE + HANDLERS)

### 5a. List filtering — `accessibleProjectSelectors`

Per-project grants break "one org-wide `project:read` check then list
everything". Lists must filter server-side (`feedback_server_side_list_ops`).

New pure helper in `auth/policy-match.ts`:

```ts
/** Which projects can this actor read? Deny-aware, complement-capable. */
export type ProjectReadScope =
  | { kind: "all"; except: ReadonlySet<string> }
  | { kind: "ids"; ids: ReadonlySet<string> };
export const accessibleProjectIds = (
  statements: readonly PolicyStatement[],
): ProjectReadScope;
```

Semantics: collect selectors of allow-statements whose actions match
`project:read` AT the `project/{id}` path; `*` / `project` / `project/*` →
`kind:"all"` with per-id denies carried in `except` (deny-wins even against an
allow-all); otherwise the literal id set minus denies (`deny */project/*` →
empty). Owner/superadmin → all before evaluation. The repo filter binds the id
list as ONE `json_each` parameter, immune to the D1 100-param ceiling.

Consumers:

- `handlers/projects.ts` list: pass to `ProjectRepo.list` as an optional
  `idFilter` (`WHERE id IN (…)`, chunked per `project_d1_bound_param_ceiling`).
- Project switcher + dashboard counts reuse the same filtered repo read.
- Everything below project level already gates per-object with the target's
  projectId — unchanged.

### 5b. `/api/me` capability surface (HANDLERS)

Extend the existing `canInviteMembers` / `canRemoveMembers` /
`canManagePolicies` block (`handlers/me.ts`) to a full sidebar contract:

```
canManageMembers      member:update            (org)
canInviteMembers      invitation:create        (org)   — existing
canRemoveMembers      member:delete            (org)   — existing
canManagePolicies     policy:update            (org)   — existing
canViewPolicies       policy:read              (org)
canViewAuditLog       auditLog:read            (org)
canViewCredentials    appleCredential:read     (org)
canViewDevices        device:read              (org)
canViewVaultAccess    vaultAccess:read         (org)
canViewRobots         robotAccount:read        (org)
canManageOrgEnvVars   envVar:read on project/global subtree (assertAccessAny)
canManageOrgSettings  organization:update      (org)
```

Web consumes these to render the sidebar (§9e). Server remains the only
authority — hiding is UX, `assertAccess` still guards every endpoint.

### 5c. Protected environments API (HANDLERS + CONTRACTS)

- `GET /api/environments` (existing surface) gains `protected: boolean` per
  environment (merge from `protected_environment`).
- `PUT/DELETE /api/environments/:name/protection` — gate
  `assertAccess("environment", "update")` (org target). Audit-logged.

---

## 6. Attachment semantics (unchanged mechanics, new vocabulary)

- One member/robot/group may hold any mix: parameterized project roles,
  capabilities, `managed:admin`, real policies. Union of allows, deny-wins —
  engine unchanged.
- Multiple project roles compose: `developer@*` + `maintainer@projA` =
  maintainer in A, developer elsewhere (works BECAUSE protection is allow-list
  compiled, §2d).
- Groups are the team mechanism: attach `maintainer@projA` +
  `managed:cap-credentials` to group "iOS team", membership does the rest.
- Robots: recommended CI shape = `developer@{project}` (publish
  non-protected) or `maintainer@{project}` (publish prod). The
  robot-rotation boundary check (`robotAccount:update` + `isWithinBoundary`)
  is unchanged.

---

## 7. Bare role ids are REMOVED (no aliasing, no legacy layer)

The old org-wide presets `managed:developer` / `managed:viewer` are GONE:

- `parseManagedId` rejects bare role ids — project roles exist ONLY in the
  explicit `managed:{role}@{scope}` form. `managed:admin` is the sole
  non-capability static id (it maps 1:1 to the "Admin" org role).
- Migration `0083_drop_bare_managed_role_attachments.sql` DELETEs any
  `policy_attachment` / `invitation_grant` rows carrying the bare ids, so no
  inert rows linger. Holders lose everything those presets granted; an admin
  re-grants explicitly (project roles via `@scope` ids, org-shared surfaces via
  capabilities) — a one-time, deliberate manual pass after deploy.
- Attach/detach and invitation grants validate against the strict grammar; a
  bare id is rejected with 404 ("Unknown managed policy id").

---

## 8. Server handler changes (HANDLERS)

### 8a. `handlers/policy-attachments.ts` (EDIT)

- Validate parameterized ids: parse via `parseManagedId`; scope must be `*` or
  an existing project in the org (one repo read). Bare role ids are accepted
  (alias, §7) but normalized to the `@*` form before insert so the table only
  ever gains explicit ids.

### 8b. `handlers/policies.ts` (EDIT)

- List endpoint: managed section now returns admin + 3 capabilities.
  Parameterized ids are NOT listed (they're a grammar, not rows) — the UI
  composes them.
- Each managed entry gains `name`, `description`, `summary` (human strings
  served from code — single source for web + CLI labels).

### 8c. Member directory decision (documented, not new code)

`authClient.organization.listMembers` stays membership-gated (better-auth),
NOT IAM-gated: **any org member sees the directory** (names, emails, org role,
join date) — GitHub-organization behavior, now deliberate. IAM-enriched data
(attachments, robot accounts, invitations) stays behind
`policy:read`/`robotAccount:read`/`invitation:read` via our own endpoints.
Add this as a third documented better-auth exception in `UNIFIED-AUTHZ.md`
(alongside org create/delete).

### 8d. Invitation grants (HANDLERS + CORE)

- Invite endpoint accepts `grants: string[]` (policy ids, same grammar).
  Validate each (§8a rules) + boundary-check against the INVITER (an admin
  cannot smuggle grants they could not attach directly).
- Store in `invitation_grant`; on invitation accept (better-auth
  `organization` hook where membership is created), create the attachments
  with the new member as principal, then delete the rows. On cancel/expiry,
  sweep.
- Audit events: `invitation.grants_set`, `member.grants_applied`.

---

## 9. Web UX (WEB — `apps/web`)

Design goal: **the Members page is the access-control surface**; policies/groups
become "Advanced". No raw ids, no statement counts, no token dropdowns in the
primary path.

### 9a. Members table (`routes/_authed/_app/members.tsx` + children, EDIT)

- Replace the `Role` column (better-auth Owner/Member) with an **Access**
  column summarizing effective grants as chips, e.g.
  `Owner` · `Admin` · `Developer — all projects` · `Maintainer — 2 projects`
  · `+Credentials` · `+Auditor` · `Custom ×2`. Data: one new
  endpoint `GET /api/members/access-summaries` (server-computed, paginated
  with the member list — do NOT N+1 the attachments per row).
- Row action (and row click) → **Access sheet** (replaces the "Manage
  policies" dialog).

### 9b. Access sheet (NEW: `-member-access-sheet.tsx`)

Single Sheet, three sections + advanced:

1. **Org role** — radio: `Member` (default) / `Admin`, with one-line
   descriptions. Switching to Admin attaches `managed:admin` (and the section
   explains project roles/capabilities become moot); switching away detaches
   it. Owner transfer stays in Organization settings (unchanged).
2. **Project access** — list of grant rows: `[scope: All projects | <project
picker>] [role: Maintainer | Developer | Viewer]` + remove. Each role option
   shows its one-line description (from §8b summaries) and a "Developer
   cannot write protected environments" hint. Add row → attach parameterized
   id; remove → detach.
3. **Capabilities** — three checkboxes with descriptions. The Credentials row
   additionally shows a **vault chip**: `In credential vault` /
   `Not in vault — grant access` (links to the existing vault-access grant
   flow). Detaching Credentials surfaces the existing revocation guidance
   (rotation recommendation) — permission detach never rotates keys by itself.
4. **Advanced** (collapsed) — the existing custom-policy attach panel
   (`-policy-attach-panel.tsx`) for real policies.

All mutations via the typed client (`feedback_typed_api_client`), coss
primitives only, dialog state per `feedback_dialog_key_bump_pattern`.

### 9c. Invite dialog (EDIT)

Add the same Project access + Capabilities pickers (compact). Selected grants
go to `invitation_grant` (§8d). Default: one row `Developer — all projects`
pre-filled? NO — default EMPTY (explicit is the point of this redesign); the
inviter must choose (a hint suggests common setups).

### 9d. Policies + Groups pages (EDIT — demoted, not removed)

- Nav: move under an "Advanced" heading; keep routes.
- Policies list: drop the "N statements" column; add `Description` and
  `Used by` (attachment count). Managed rows show the human summary.
- Policy view dialog: lead with a **permission matrix** (rows = resources with
  human labels from an extended `-policy-vocabulary.ts`; columns =
  read/create/update/delete/other; cells ✓/scope note), statements accordion
  below for the exact document.
- Policy builder: action picker becomes grouped-by-resource with human labels
  - per-action descriptions; resource selector gets a structured scope picker
    (Org-wide / Project / Project+Environment dropdowns emitting the glob) with
    a raw-input toggle for experts.
- Groups: group detail gains the same Access sheet sections (grants attach to
  the group), so "team = group + grants" is one screen.

### 9e. Permission-aware chrome

- Sidebar sections render per `/api/me` capabilities (§5b): a plain member
  sees Projects (+ Members directory); Access-control / Credentials / Robots /
  Org-env-vars / Audit entries appear only with the corresponding `can*`.
- Route guards: capability-gated routes redirect to `/projects` with a toast
  when the capability is absent (server still enforces regardless).
- Robots page: the robot "Manage policies" dialog is replaced by the same
  Access sheet (sections 2–4; no org-role section — robots are never admin).

### 9f. Organization settings — Environments (EDIT)

Environments card gains a `Protected` switch per row (built-ins + custom),
gated by `canManageOrgSettings`; production ships ON. Copy explains the
Developer-role consequence in one line.

---

## 10. CLI (CLI — `apps/cli`) + skill

- New sugar command group `better-update access`:
  - `access list [--member <email> | --robot <name> | --group <name>]`
  - `access grant --member <email> --role developer [--project <id|slug|all>]`
    → composes the parameterized id and calls the attachments API. Also
    `--capability credentials|auditor|billing`.
  - `access revoke …` (mirror).
- `policies` / `groups` command groups unchanged (advanced path). Attach
  commands accept parameterized ids directly.
- Update `skills/better-update/` (SKILL.md + cli.md + an `access`/IAM topic
  ref) in the SAME change (`feedback_keep_skill_in_sync`).
- Mind CLI e2e key limits (`project_cli_e2e_apikey_ratelimit`).

---

## 11. Tests (TESTS)

- **Unit (pure)** `auth/managed-policies.test.ts`: `parseManagedId` grammar
  (valid/malformed/bare-alias → `@*`); compiler truth tables —
  maintainer/developer/viewer docs for scope `X` and `*`, with/without
  protected envs; developer emits NO write statement for a protected env;
  capability docs match their maps.
- **Unit (pure)** `auth/policy-match.test.ts` (EXTEND): `accessibleProjectIds`
  truth table — explicit ids, `*`, `project/*`, deny removal, deny-all, empty.
- **Unit** composition via `it.effect` on `assertAccess`: `developer@*` +
  `maintainer@A` → prod write in A allowed, prod write in B denied, preview
  write in B allowed; `viewer@A` denied `envVar:read`; capability grants org
  resources but never project writes; baseline member gets `organization:read`
  and nothing else.
- **Integration** (real D1): protected-env repo; resolution context fetch only
  when parameterized ids present; invitation_grant apply-on-accept sweep;
  access-summaries endpoint shape.
- **E2E** (`project_e2e_pool_workers`, run MANUALLY —
  `feedback_e2e_long_running`): invite with grants → accept → member has
  exactly those grants; a pre-existing bare `managed:developer` attachment
  authorizes a preview publish but is denied credentials download (alias
  semantics); projects list filtered for a single-project grantee; robot with
  `developer@A` publishes preview-A, denied prod-A. Web e2e: Access sheet happy
  path (mind `project_e2e_baseui_toast_dialog_role`).
- No framework-built-in tests (`feedback_no_framework_tests`).

---

## 12. File ownership (slices)

| Slice         | Files                                                                                                                                                                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CORE**      | migrations `0081`–`0082`; `auth/managed-policies.ts`, `auth/permissions.ts`, `auth/statements.ts`, `auth/policy-match.ts` (EDIT); `repositories/protected-environment-repo.ts`, `invitation-grant-repo.ts` (NEW); `infrastructure-layer.ts` (EDIT) |
| **CONTRACTS** | `packages/api`: managed-policy summaries on policies group, `grants` on invite body, `protected` on environments, access-summaries endpoint, `/api/me` capability fields                                                                           |
| **HANDLERS**  | `policy-attachments.ts`, `policies.ts`, `me.ts`, `projects.ts` (list filter), environments protection endpoints, invitation accept hook wiring, audit events                                                                                       |
| **WEB**       | members table + `-member-access-sheet.tsx` (NEW), invite dialog, robots dialog swap, policies/groups demotion + matrix view + grouped builder, sidebar gating, env protection toggle                                                               |
| **CLI**       | `commands/access/*` (NEW); `skills/better-update` updates                                                                                                                                                                                          |
| **TESTS**     | as §11                                                                                                                                                                                                                                             |

Suggested landing order (each independently shippable, prod-safe):

1. CORE compiler + bare-id aliasing + protected-env table. NOTE: this step
   already changes what existing developer/viewer attachments grant (§7) — do
   the capability re-grant pass right after deploy.
2. HANDLERS validation + summaries + me capabilities + list filtering.
3. WEB Access sheet + members table (reads new endpoints).
4. Invite grants + robots + CLI + demoted policy pages.

---

## 13. Verification

1. `bun run lint` (re-run once on spurious `no-unsafe-*`).
2. `bun run test` (pure compiler + matcher tables must hit the coverage gate).
3. `bun run test:integrations`.
4. `bun run test:e2e` MANUALLY for the cross-flow journeys.
5. `bun run format`.

Out of scope (stop + ask before adding): ABAC conditions, nested groups,
per-credential path scoping (the reserved `credential` ObjectRef stays
reserved), project-scoped audit log (noted future work), delegation (letting
maintainers invite), any new top-level dir under `apps/server/src/`.
