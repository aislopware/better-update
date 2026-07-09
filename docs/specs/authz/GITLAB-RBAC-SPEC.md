# GitLab-style RBAC — Fixed Roles + Project Membership + Protected Resources

Status: AUTHORITATIVE (2026-07-03) — role matrix signed off by owner
(2026-07-03): §2a decisions all resolved to the first-listed option
(project:create = any member; protected credentials = ≥M⚑; team-less Apple
credentials = always protected; organization:update = ≥A). SUPERSEDES
`POLICY-GROUPS-SPEC.md` (the policy/group engine) and what remained in force of
`ROLES-CAPABILITIES-SPEC.md`, EXCEPT: the protected-environment guard concept
(§2d there) survives generalized here, and the `/api/me` capability contract
survives with a new backing computation.

v2 (owner decision, 2026-07-03, later the same day): **credential bindings +
project-scoped robots.** (1) Org-scoped credentials are usable in a project
ONLY when explicitly bound to it (§3c) — the "anywhere rank" shortcut of v1 is
retired for credentials/devices (it survives solely for org-global env-var
reads). (2) Robot accounts are project-scoped: one robot = one project + one
project role; `org_role` is dropped and robot management moves to project
Maintainers (§1b). Decided via AskUserQuestion, all first-listed options:
robot = 1 project; robot mgmt = project ≥M; bindings = org admin + auto-bind
when a Maintainer creates a credential from project context.

Decision context (owner decision, 2026-07-03):

- The policy/group engine is over-engineered for this product. Replace it with
  GitLab-shaped RBAC: a fixed role ladder, per-project membership, and
  per-resource "protected" toggles.
- **No backward compatibility required for authz.** Prod has few users; the
  owner re-assigns roles by hand after deploy. Migrations MAY drop the policy
  tables outright. (The org-wide prod-compat rule still applies to everything
  else — only the authz surface is exempted, once.)
- Apple team protection CASCADES: a protected team makes every child
  credential (dist certs, push keys/certs, provisioning profiles, pass-type/
  pay certs, ASC API keys) protected. Children have NO independent toggle.

Toolchain reminders (project rules): `bun`/`bunx` only; `bun run lint` =
lint+typecheck; `bun run format` (oxfmt). Extensionless imports. No `== null`.
`Effect.promise`/`tryPromise` only in `repositories/` + `cloudflare/*Live`.
Handlers never throw. Additive-vs-drop rule: see decision above.

---

## 1. The model

Two membership layers + one ladder, exactly GitLab's shape:

```
Org role      (member.role)            owner | admin | member
Project role  (project_member.role)    maintainer | developer | reporter
```

- **Owner** — org root. Unconditional, undeniable allow (unchanged from today,
  `auth/owner.ts`). Billing, org delete, granting/revoking `admin`.
- **Admin** — org management: members, invitations, robots, vault access,
  webhooks, audit log, org environments, protection toggles, org settings.
  Implicit **maintainer on every project**.
- **Member** — baseline. Sees the org, sees ONLY projects where they hold a
  `project_member` row. No row ⇒ the project 404s (enumeration-safe, reuses
  `auth/ownership.ts`).

Project roles (per `project_member` row; one row per principal per project):

- **Maintainer** — full control of the project incl. protected environments,
  project settings, project member management (up to maintainer), deletes.
- **Developer** — daily work: publish updates, create branches/channels,
  builds, submissions, env vars — on NON-protected environments only.
- **Reporter** — read + download everything in the project; no writes.

Effective project role = `max(orgRoleImplied, projectMemberRole)` where
`owner|admin ⇒ maintainer` (owner additionally bypasses everything). There are
no deny rules, no path globs, no boundaries — escalation is structural (a
maintainer has no lever that grants admin/owner).

### 1a. Credential→project bindings (v2; replaces the v1 "anywhere rank")

Credentials are stored at org scope but are USABLE only where bound. A row in
`project_credential_binding(project_id, resource_type, resource_id)` makes one
org credential available to one project. Resource types:

- `appleTeam` — binds the team row; CASCADES to every child credential (dist
  certs, push keys/certs, profiles, pass-type/pay certs, team-scoped ASC keys)
  AND to the team's registered devices (`devices.apple_team_id`). Children and
  devices have no binding of their own — same cascade shape as §3b protection.
- `ascApiKey` — ONLY for team-less ASC keys (they have no team to ride on).
- `googleServiceAccountKey`, `androidUploadKeystore` — per-row.

Access rule for a member (non-admin): an action on a credential/device is
allowed iff SOME bound project gives them the required effective rank —
`developer` for read/create/update/download, `maintainer` for delete, and
`maintainer` for EVERYTHING when the row is protected (§3b). An UNBOUND
credential is admin-only. Owner/admin/superadmin bypass bindings entirely
(implicit maintainer everywhere).

Binding management: org admin/owner (`credentialBinding:*` = ≥A), routes
mirror the protection toggles. PLUS auto-bind: when a project Maintainer
creates a credential from CLI project context, the create payload carries
`projectId` and the new credential (or its team) is bound to that project in
the same request — a Maintainer can bootstrap CI without an admin, but cannot
bind PRE-EXISTING credentials to new projects. Every binding INSERT is
audit-logged as `credentialBinding.create` (auto-binds carry
`metadata.auto: true`); idempotent re-binds log nothing. For bulk
re-binding after the no-backfill migration, `GET
/api/credential-bindings/plan` (≥A) derives the bindings existing iOS
bundle configurations + Android build-credential groups rely on, flagged
bound/missing (`credentials bindings plan --apply` binds the missing ones).
Config writes validate referenced credential ids exist in the org
(NotFound otherwise); binding state itself is only enforced at resolve.

ORG-WIDE ("all projects") bindings (mig 0095): a row in
`org_credential_binding(organization_id, resource_type, resource_id)` binds
the resource to EVERY project of the org — present AND future. Resolution is
query-time: the binding repo expands an org-wide row into the org's full
project-id set inside `boundProjectIds`/`boundProjectIdsByResource`, so every
downstream gate keeps its "target project ∈ bound set" shape and a newly
created project is covered with zero writes. Same resource kinds, same
cascade (an org-wide-bound `appleTeam` covers all children + devices
everywhere), same admin-only management (`PUT/DELETE
/api/credential-bindings/all-projects/:resourceType/:resourceId`, CLI
`credentials bindings add|remove --all-projects`). Audit rows carry
`metadata.allProjects: true`. Unbinding org-wide falls back to whatever
explicit per-project rows remain. Credential list responses expose
`boundToAllProjects` (team-scoped ASC keys inherit their team's flag);
`bindings list` entries synthesized from the org-wide row carry
`allProjects: true` and shadow an explicit row for the same resource.

The v1 `anywhereRank` helper survives for exactly ONE rule: org-global env-var
reads (`envVar:read` on the `global` sentinel) stay at ≥D-anywhere — global
env vars are org config shared by design, not credentials.

### 1b. Robots (v2: project-scoped)

One robot = ONE project + one project role, GitLab project access tokens'
shape: `robot_account.project_id` (FK, CASCADE on project delete) +
`robot_account.project_role` (`maintainer|developer|reporter`). `org_role` is
DROPPED; there are no org-level robots and no multi-project grants
(`project_member` never holds robot rows anymore). The bearer resolves to
`orgRole='member'` + `projectRoles = {[projectId]: projectRole}`, so a robot
can do exactly what a human with that one membership row could do — plus
nothing org-level.

Management is project-scoped: create/rotate/revoke/read = effective ≥M on the
robot's project (`robotAccount:*` moves into PROJECT_RULES). Routes stay flat
(`/api/robot-accounts` with `projectId` in body/row) so legacy rows remain
listable/revocable. Vault mechanics unchanged: the robot's machine key is an
org-vault recipient; GRANTING vault access still takes an org admin who holds
vault membership (`vaultAccess:*` unchanged) — a plain Maintainer can mint an
OTA-publishing robot but not a credential-decrypting one.

Migration posture: existing robots (all v1, org-scoped) get
`project_id = NULL` and STOP AUTHENTICATING (`verifyBearer` requires a
project); they stay visible in the org list flagged "legacy — recreate", so
their vault access can be revoked through the normal flow. No backfill guess.

---

## 2. Role × action matrix

The matrix is STATIC CODE (`auth/role-matrix.ts`), the successor of
`permissions.ts`'s preset maps. `assertAccess(resource, action, target)` keeps
its exact call-site signature; only its internals change (§4).

Rank shorthand: `R` reporter, `D` developer, `M` maintainer, `A` org admin,
`O` owner, `—` nobody below owner. "≥X" = that rank or higher on the TARGET
project. Credential rows (marked ⚓) require the rank on SOME project the
credential is BOUND to (§1a); ⚑ marks the one surviving anywhere-rank rule.

### Project-scoped

| resource                                                              | read           | create  | update | delete | other                               |
| --------------------------------------------------------------------- | -------------- | ------- | ------ | ------ | ----------------------------------- |
| project                                                               | ≥R             | see §2a | ≥M     | ≥A     | archive/unarchive = update          |
| branch                                                                | ≥R             | ≥D      | ≥D     | ≥M     |                                     |
| channel                                                               | ≥R             | ≥D      | ≥D     | ≥M     |                                     |
| update (OTA)                                                          | ≥R             | ≥D      | —      | ≥M     | republish = create                  |
| rollout                                                               | ≥R             |         | ≥D     |        |                                     |
| build                                                                 | ≥R (+download) | ≥D      |        | ≥M     |                                     |
| submission                                                            | ≥R             | ≥D      |        | ≥M     | cancel ≥D                           |
| envVar                                                                | ≥D             | ≥D      | ≥D     | ≥D     | org-global vars: read ≥D⚑, write ≥A |
| iosAppMetadata                                                        | ≥R             | ≥D      | ≥D     | ≥M     |                                     |
| iosBundleConfiguration                                                | ≥R             | ≥D      | ≥D     | ≥M     |                                     |
| androidCredential (project: app identifiers, build-credential groups) | ≥R             | ≥D      | ≥D     | ≥M     |                                     |

All writes above additionally pass the guards in §3 (archived project,
protected environment).

### Org-scoped

| resource                                            | rule                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| organization                                        | read: any member · update: ≥A · delete: O (better-auth, unchanged)                                                                                                                                                                                                                                                                             |
| member                                              | read (directory): any member · role change / remove: ≥A · granting or revoking `admin`/`owner`: O only                                                                                                                                                                                                                                         |
| invitation                                          | org-level (role member/admin): ≥A · project-level grants ≤ maintainer: project ≥M may invite to THEIR project                                                                                                                                                                                                                                  |
| project_member                                      | read: ≥R on that project · add/update/remove up to maintainer: ≥M on that project                                                                                                                                                                                                                                                              |
| robotAccount                                        | v2: PROJECT rule — ≥M on the robot's project (create/rotate/revoke/read); legacy NULL-project rows: ≥A                                                                                                                                                                                                                                         |
| credentialBinding                                   | v2: read ≥A · bind/unbind ≥A · auto-bind on create by project ≥M (create payload `projectId`)                                                                                                                                                                                                                                                  |
| vaultAccess                                         | administration (grant others, bootstrap, cutover, rotate — `vaultAccess:*`): ≥A · participation (enrol OWN device/account key, self-link, fetch own wrap, decrypt-metadata reads): ≥D⚑ anywhere (`assertVaultParticipant`, 2026-07-08 amendment — the ≥A-everything reading broke `identity create` for maintainers and robot CI wrap fetches) |
| auditLog                                            | ≥A                                                                                                                                                                                                                                                                                                                                             |
| webhook                                             | ≥A                                                                                                                                                                                                                                                                                                                                             |
| device                                              | ≥D⚓ via the device's team binding (read/create/update/delete); team-less registration requests: ≥A                                                                                                                                                                                                                                            |
| environment (org env names + protection toggle)     | read: any member · create/update/delete/protect: ≥A                                                                                                                                                                                                                                                                                            |
| billing                                             | O                                                                                                                                                                                                                                                                                                                                              |
| appleCredential                                     | §3b — non-protected row: ≥D⚓ (read/update/download), delete ≥M⚓ · row-protected: ≥M⚓ (all actions) · create under a protected TEAM: ≥M⚓ · protect toggles: ≥A                                                                                                                                                                              |
| androidCredential (org: upload keystores, GSA keys) | same ladder as appleCredential, per-row toggle + per-row binding                                                                                                                                                                                                                                                                               |
| project:create                                      | any org member; creator is auto-added as its maintainer                                                                                                                                                                                                                                                                                        |

Superadmin (platform, cross-org) is untouched.

### 2a. Explicit decision points (pending owner sign-off)

1. `project:create` = any org member (GitLab: developers may create group
   projects). Alternative: ≥A.
2. Protected credentials = ≥M⚑ (maintainers can still build with protected
   certs; vault membership is the real secret gate). Alternative: ≥A.
3. Team-less Apple credentials (issuer-only ASC keys, path segment `none`) =
   protected BY DEFAULT (≥M⚑): created protected, 0093-backfilled protected.
   They are org-wide powerful and have no team to inherit from; since v2.2
   they carry their own per-row toggle (org admin may unprotect).
4. `organization:update` = ≥A (today's `managed:admin` behavior). Alternative:
   O only (GitLab group settings).

---

## 3. Protected resources

One concept, two axes, same shape as today's protected environments: a flag +
a guard inside `assertAccess`, checked AFTER the base matrix allow
(allow-conjunction, never a deny).

### 3a. Protected environments (covers branches, channels, updates, rollouts, env vars)

Keeps the existing `protected_environment(organization_id, environment)` table,
repo, seed (`production` on org create), toggle route
(`PUT/DELETE /api/environments/:name/protection`), and UI switch — unchanged.
Only the guard's question changes:

> WRITE where `ObjectRef` carries `environment` ∈ protected set ⇒ require
> effective project role ≥ **maintainer** on that project.

(Replaces the `environment:update`-statement check at
`auth/policy.ts:101-125`. The user-visible semantics of the toggle are
identical to GitLab protected branches: developers cannot push to protected,
maintainers can.)

### 3b. Protected credentials

Flags, presence-column style, two INDEPENDENT levels on the Apple axis (v2.2
— migration 0093 added the per-row columns; before that the team flag was the
only Apple toggle and cascaded):

- Every Apple child table (`apple_distribution_certificates`,
  `apple_push_keys`, `apple_push_certificates`, `apple_pay_certificates`,
  `apple_pass_type_certificates`, `apple_provisioning_profiles`,
  `asc_api_keys`) carries its own `is_protected INTEGER NOT NULL DEFAULT 0` —
  **the ONLY flag that gates actions on an existing credential** (read/
  download/build/delete). A protected team with an unprotected child does NOT
  stop a developer from using that child.
- `apple_teams.is_protected` gates **team-level interactions** instead:
  creating a credential under the team (`assertAppleCredentialCreate` raises
  the create rank to maintainer — checked before upload, right after the CLI
  team pick), team-row visibility, and the team's devices. It is also the
  **default for new children**: uploads snapshot `team.is_protected` onto the
  new row (a later team toggle does not touch existing rows).
- Team-less Apple credentials (sentinel segment `none`, issuer-only ASC
  keys): **created protected** (preserving the old "always protected" §2a-3
  behavior); an org admin may unprotect them.
- 0093 backfills **every existing credential row to protected** — the 7
  Apple child tables plus `apple_teams`, `google_service_account_keys` and
  `android_upload_keystores` (owner decision 2026-07-04): the fleet starts
  locked down and admins unprotect selectively. This strictly covers the two
  no-regression cases (children of protected teams under the old cascade,
  always-protected team-less keys) — the deliberate cost is that
  previously-open credentials now need an admin unprotect before developers
  can use them again.
- `google_service_account_keys.is_protected`, `android_upload_keystores.is_protected`
  — per-row toggles (no parent).

Guard: any action on a row-protected credential ⇒ require anywhere-rank ≥
maintainer (§2a-2). Enforcement lives in the credential access helpers
(`auth/apple-team-access.ts` — callers pass the row's own flag as
`credentialIsProtected` / `itemProtectedOf` — and
`auth/android-credential-access.ts`) and the list filters — the handlers
already resolve the row/team, so the flag is checked there rather than inside
the generic `assertAccess` (which would need its own repo lookups). Toggle
mutations: `PUT/DELETE /api/apple/<type>/:id/protection` per child type plus
the team route, ≥A (`assertOrgAdmin`), audit-logged (`appleTeam.protect` /
`apple.distribution-certificate.protect` / `.unprotect`, etc.).

`apple-team-access.ts` survives: same responsibilities (internal id ↔ 10-char
team id, list filtering, create-before-upsert gate), but `isAllowed`/glob calls
become rank comparisons + the protected-team lookup.

### 3c. Credential bindings (v2)

```sql
-- 0091
CREATE TABLE project_credential_binding (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL CHECK (resource_type IN
    ('appleTeam','ascApiKey','googleServiceAccountKey','androidUploadKeystore')),
  resource_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (project_id, resource_type, resource_id)
);
```

Semantics in §1a. Enforcement joins the protected ladder in the SAME helpers
(`apple-team-access.ts`, `android-credential-access.ts`): the handler resolves
the row (+ team), loads its bound project ids once, and the pure check is
`boundCredentialAllowed(ctx, boundProjectIds, requiredRank)` — true iff
owner/admin/superadmin or `effectiveProjectRole` on some bound project meets
`credentialRequiredRank(base, isProtected)`. List endpoints filter the same
way (one bindings query per list, not per row). `build-credentials/resolve`
resolves ONLY credentials bound to the target project. No backfill: existing
credentials start unbound (admin-only) — the owner binds by hand post-deploy.

Deleting a credential/team removes its binding rows (repo-level, same batch).
Deleting a project cascades via FK.

---

## 4. Engine replacement

### 4a. Schema

New tables/columns (migrations, in order):

```sql
-- 0086: project membership (humans + robots)
CREATE TABLE project_member (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  principal_type TEXT NOT NULL CHECK (principal_type IN ('member','robot')),
  principal_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('maintainer','developer','reporter')),
  created_at TEXT NOT NULL,
  updated_at TEXT,
  UNIQUE (project_id, principal_type, principal_id)
);

-- 0087: invitation carries project grants (replaces invitation_grant)
CREATE TABLE invitation_project_grant (
  invitation_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('maintainer','developer','reporter')),
  PRIMARY KEY (invitation_id, project_id)
);

-- 0088: protected flags
ALTER TABLE apple_teams ADD COLUMN is_protected INTEGER NOT NULL DEFAULT 0;
ALTER TABLE google_service_account_keys ADD COLUMN is_protected INTEGER NOT NULL DEFAULT 0;
ALTER TABLE android_upload_keystores ADD COLUMN is_protected INTEGER NOT NULL DEFAULT 0;

-- 0089: robot org role
ALTER TABLE robot_account ADD COLUMN org_role TEXT NOT NULL DEFAULT 'member'
  CHECK (org_role IN ('admin','member'));

-- 0090 (last, after code no longer reads them): DROP
DROP TABLE policy_attachment; DROP TABLE iam_group_membership;
DROP TABLE iam_group; DROP TABLE policy; DROP TABLE invitation_grant;

-- 0091 (v2): project_credential_binding — see §3c.

-- 0092 (v2): robot project scope
ALTER TABLE robot_account ADD COLUMN project_id TEXT REFERENCES projects(id)
  ON DELETE CASCADE;                    -- NULL = legacy, cannot authenticate
ALTER TABLE robot_account ADD COLUMN project_role TEXT
  CHECK (project_role IN ('maintainer','developer','reporter'));
ALTER TABLE robot_account DROP COLUMN org_role;
DELETE FROM project_member WHERE principal_type = 'robot';  -- v1 robot grants
```

Data migration inside 0086/0090: holders of a `managed:admin` attachment get
`member.role = 'admin'` (SQL UPDATE from `policy_attachment` before the drop);
every existing org member additionally gets a `project_member` developer row on
every existing project of their org, so nobody is locked out on deploy day —
the owner then prunes/adjusts by hand (accepted). Robots with `managed:admin`
get `org_role='admin'`; other robots get developer rows on all projects
(same prune-by-hand story).

`member.role` becomes meaningful beyond `owner`: `owner | admin | member`
(written ONLY via IAM routes; better-auth's own role routes stay dormant).

### 4b. Code

Dies (delete outright):

- `auth/policy-match.ts` (glob matcher), `auth/policy-boundary.ts`,
  `auth/statements.ts`, `auth/managed-policies.ts`.
- `PolicyStatement`/`PolicyDocument`/`PolicyModel`/`GroupModel`/
  `PolicyAttachmentModel` from `authz-models.ts`; `effectiveStatements` from
  `CurrentActor`.
- Repos + handlers + api groups + api-client modules for policies, groups,
  policy-attachments; `invitation_grant` plumbing in `org-lifecycle.ts`.
- `resolveEffectiveStatements` in `auth/middleware.ts`.

Replaced:

- `auth/role-matrix.ts` (new): the §2 matrix as data —
  `projectMatrix: Record<ProjectRole, ReadonlySet<`${Resource}:${Action}`>>` +
  org-scope rules keyed by org role, with unit tests asserting the table
  matches this spec.
- `CurrentActor` gains `orgRole: 'owner'|'admin'|'member'` and
  `projectRoles: ReadonlyMap<string, ProjectRole>` (resolved once per request
  in `middleware.ts` — one `project_member` query by principal), plus
  `anywhereRank` derived.
- `assertAccess` internals: archived guard (unchanged) → owner/superadmin
  bypass (unchanged) → matrix lookup by effective role for the target's
  project (org target ⇒ org-role rules; ⚑ resources ⇒ anywhere-rank) →
  protected-environment guard (role-rank form) → protected-credential guard.
  `assertAccessAny` becomes an anywhere-rank check. Signature and all ~52 call
  sites: UNCHANGED.
- `resolvePath` shrinks to what error messages/audit need; ObjectRef union
  stays as the resource locator.
- Project list filtering (`accessibleProjectIds`): membership query instead of
  statement walking.

Survives as-is: `owner.ts`, `ownership.ts`, `superadmin.ts`, `memberships.ts`,
`constants.ts`, `context.ts` (type re-exports updated), archived guard,
`seedProtectedEnvironments`, robot bearer mechanics, vault everything.

### 4c. API surface

Removed: `/api/policies*`, `/api/groups*`, all policy-attachment routes.

Added/changed:

- `GET/POST /api/projects/:id/members`,
  `PATCH/DELETE /api/projects/:id/members/:principalId` (role in body;
  `principal_type` member|robot).
- `PATCH /api/members/:id` — org role change (admin↔member; owner transfer
  stays better-auth/owner-only).
- `POST /api/invitations` body gains `role: 'admin'|'member'` +
  `projects: [{projectId, role}]`; accept materializes `project_member` rows
  (successor of `applyInvitationGrants`).
- `POST /api/robot-accounts` (v2) requires `projectId` + `role`
  (maintainer|developer|reporter); no orgRole, no grants. List/rotate/revoke
  gate on ≥M of the row's project (legacy NULL-project rows: ≥A). Robot list
  entries carry `projectId`/`role` (null for legacy).
- Binding routes (v2, ≥A): `GET /api/projects/:id/credential-bindings`,
  `PUT/DELETE /api/projects/:id/credential-bindings/:resourceType/:resourceId`,
  plus `GET /api/credential-bindings/plan` (config-derived bind plan, §1a).
  Credential create payloads accept optional `projectId` for the ≥M auto-bind
  path. Credential list/detail responses carry `boundProjectIds`.
- Project-member routes admit `principalType: "member"` ONLY (v2): robots
  are not project members — their single project role lives on
  `robot_account` (§1b), so the API literal, the server types, and the web
  add-member picker are member-only.
- Credential/team routes gain `PUT/DELETE .../protection` (apple team, GSA
  key, upload keystore) mirroring the environment protection route shape.
- `GET /api/me`: same boolean capability names, recomputed from the matrix;
  plus `orgRole` and `projectRoles: Record<projectId, role>` so the web UI can
  gate per-project chrome.

### 4d. Web UI

- Members page: role column becomes a plain select (Owner/Admin/Member); the
  policy attach/detach panels, access sheets/chips, robot policy dialogs are
  deleted. Invite dialog: org role + optional project/role rows.
- `policies/` and `groups/` routes: deleted.
- Project settings gains a **Members** tab (list/add/change/remove, GitLab
  style).
- Protection switches: reuse the environments `ProtectionSwitch` pattern on
  Apple team rows, GSA keys, upload keystores; child credentials show the
  inherited badge.
- `lib/access.ts` keeps `assertCapability`; sidebar gating driven by the new
  `/api/me`.

### 4e. CLI (+ skill sync)

- Delete `policies` and `groups` command trees.
- v2: `robot create --project <id> --role <maintainer|developer|reporter>`
  (project defaults from the linked project context); `robot grant` /
  `robot revoke-access` are DELETED (one robot = one project, role set at
  creation; `robot update --role` if needed later). `identity create-ci` is
  project-scoped the same way.
- v2: credential-creating commands pass the linked `projectId` (auto-bind
  §1a); `credentials bindings list|plan|add|remove` subcommands for admins
  (`plan --apply` = bulk re-bind from existing configs).
- New `members` helpers only if needed by CI flows; otherwise web-only.
- Same change updates `skills/better-update/` (SKILL.md + cli.md + topic ref)
  — mandatory per repo convention.

---

## 5. Implementation waves (each ends green: `bun run lint` + unit tests; e2e per wave where flows change)

1. **Engine**: migrations 0086–0089, `project_member` repo, `role-matrix.ts`,
   `CurrentActor`/middleware resolution, `assertAccess` internals + both
   protected guards, list filtering. Old tables still present but unread.
   Unit tests: matrix, guards, effective-role resolution, robot rank.
2. **IAM API**: project-member routes, member org-role route, invitations with
   project grants, robot orgRole/grants, protection toggle routes, `/api/me`.
   Delete policies/groups/attachments API + handlers + repos. Integration
   tests for the new routes; e2e: invite→accept→membership materialization.
3. **Web**: members page rework, project Members tab, protection switches +
   inherited badges, delete policies/groups pages, invite dialog, access.ts.
4. **CLI + skill**: command tree changes + `skills/better-update` sync; CLI
   e2e for robot grant flow.
5. **Cleanup**: migration 0090 (drops), delete dead types/specs status stamps
   (`POLICY-GROUPS-SPEC.md`, `ROLES-CAPABILITIES-SPEC.md` → SUPERSEDED by this
   file), knip sweep.
