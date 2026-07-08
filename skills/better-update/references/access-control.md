# Access control, devices, and webhooks

This reference covers the organization-management surfaces: GitLab-style RBAC (fixed org + project
roles, protected environments/credentials), Apple device registration, and webhook subscriptions.

## Access model — GitLab-style RBAC

Two fixed role ladders; no policy documents, no groups, no allow/deny statements.

**Org roles** (`owner | admin | member`):

- **Owner** — org root (set at org creation). Unconditional allow; billing, org delete,
  granting/revoking `admin`.
- **Admin** — org management (members, invitations, robots, vault access, webhooks, audit log,
  environments + protection toggles, org settings) and an **implicit maintainer on every project**.
- **Member** — baseline. Sees the org, but only the projects where they hold a project role
  (no role ⇒ the project 404s). Any member may create a project (becoming its maintainer).

**Project roles** (`maintainer | developer | reporter`, granted per principal per project):

- **Maintainer** — full project control incl. protected environments, project settings, project
  member management, deletes.
- **Developer** — daily work: publish updates, create branches/channels, builds, submissions, env
  vars — on NON-protected environments only.
- **Reporter** — read + download everything in the project; no writes.

Effective role on a project = max(org-role-implied, project role). Human roles are managed in the
web dashboard (Members page for org roles; a project's Settings → Members for project roles;
invitations can carry an org role + project grants).

**Robots are project-scoped** (GitLab project-access-token shape): one robot = **one project + one
project role**, both fixed at creation (`credentials robot create --project <id> --role
<maintainer|developer|reporter>` — see `references/credentials.md`). A robot authenticates as an org
_member_ with exactly that one project membership: it can never manage org members, webhooks, or
org settings, cannot create projects, and cannot WRITE org-global env vars (it can still READ them
with developer+). Robot management (create/rotate/revoke) takes **Maintainer+ on the robot's
project** (org admin/owner implicitly), while GRANTING a robot vault access stays an org-admin
operation (`vaultAccess:*`) — a plain Maintainer mints an OTA-publishing robot, an admin makes it
credential-decrypting (`credentials access grant <robot-id>`). `robot list` scopes to the session's
active org and, for non-admins, to projects they maintain — an empty list can just mean the wrong
active org (`better-update org list`). The dashboard lists a project's robots read-only (project →
Robot accounts, visible to Maintainer+); all mutations stay CLI-only.

**Vault participation** (self-service: `identity create`/`register`, self-linking your own device,
fetching your own key wrap to unlock, account-key enrolment in the web) requires **developer or
higher on at least one project** — org admins/owner always qualify; reporter-only members and
members with no project role are refused (403). GRANTING vault access to someone (or something)
else, bootstrap, and rotation stay org-admin operations. Losing your last developer+ project role
(downgrade to reporter, removal, project delete) drops your vault wraps and flags the vault for
rotation — access must be re-granted after you regain a qualifying role.

**Protected environments** (default: `production`) only accept writes from project **Maintainers**
(and org admins/owner) — developers cannot publish/edit branches, channels, updates, rollouts, or
env vars inside them. Toggle protection in the dashboard (Environment variables → Environments) or
via the API (org admin+).

**Org credentials are usable in a project only when BOUND to it.** Apple teams, team-less ASC API
keys, Google service-account keys, and upload keystores are stored at org scope, but a
`credential→project binding` decides where they may be used. For a non-admin member, an action on a
credential (or a registered device) is allowed iff **some bound project** gives them the required
effective rank — developer for read/create/update/download, maintainer for delete (and maintainer
for everything on protected rows). An **unbound credential is org-admin-only**. Owner/admin bypass
bindings (implicit maintainer everywhere). Binding kinds: `appleTeam` (CASCADES to every child
credential — dist/push/pass-type/pay certs, push keys, profiles, team-scoped ASC keys — and the
team's registered devices), `ascApiKey` (team-less keys only), `googleServiceAccountKey`,
`androidUploadKeystore`.

Bindings are managed by org admins — `credentials bindings list|plan|add|remove` in the CLI (see
`references/credentials.md`; `plan [--apply]` bulk re-binds whatever existing project configs rely
on) or the dashboard — PLUS **auto-bind on create**: a credential created
from CLI project context carries the linked `projectId`, and the new credential (or its Apple team)
is bound to that project in the same request. A project **Maintainer** can therefore bootstrap CI
credentials without an org admin, but cannot bind PRE-EXISTING credentials to new projects. Members
creating a brand-new team/credential MUST be in a project context they maintain (else 403).

**Build credential resolution requires bindings for everyone**: `build`/`build-credentials resolve`
hard-fails — admins included — when the resolved Apple team or upload keystore is not bound to the
target project; bind it first.

The one surviving "highest role anywhere" rule: **org-global env-var READS** (`envVar:read` on the
`global` scope) need developer-on-any-project; writes are org admin+.

**Protected credentials** require **maintainer** (via a bound project) for every action on the
credential. Each Apple child credential (dist/push/pass-type/pay certificates, push keys,
provisioning profiles, ASC API keys) carries its OWN protected toggle — the row flag is the whole
gate for using an existing credential; a protected team with an unprotected cert still lets
developers build with that cert. The Apple TEAM's protected flag instead gates team-level
interactions: creating new credentials under the team requires maintainer+ (checked at upload,
right after the CLI team pick), and it seeds the default — new children start with the team's
protected state (team-less ASC keys start protected). Toggling the team later does not change
existing children. Google service-account keys and upload keystores have per-row toggles. Toggling
protection is org admin+. Note RBAC gates the API only: decrypting credential blobs still requires
vault access (E2E).

## devices — Apple UDID registration

For ad-hoc / development provisioning, Apple needs the device UDIDs. These register them with
better-update and sync with App Store Connect; the provisioning-profile generation
(`credentials generate provisioning-profile --device-ids …`) then includes them.

```bash
better-update devices add [--udid <udid>] [--name <name>] [--device-class IPHONE|IPAD|MAC|UNKNOWN] \
  [--apple-team-id <uuid>] [--invite] [--expires-in 24h] [--no-qr]
better-update devices list [--device-class <…>] [--apple-team-id <uuid>] [--query <q>] [--enabled true|false] [--page <n>] [--limit <n>=20]
better-update devices view <id>
better-update devices sync [--apple-team-id <uuid>] [--asc-api-key-id <id>] [--no-push] [--no-pull]
better-update devices rename <id> [--name <new-name>]
better-update devices enable <id>
better-update devices disable <id>                           # keep the record but exclude from new provisioning
better-update devices delete <id> [--yes]
```

- `devices add` either registers directly (`--udid`) or, with `--invite`, generates a self-service
  enrollment URL (a QR by default; `--no-qr` to suppress, `--expires-in` to set its TTL, e.g. `7d`).
- `devices sync` reconciles with App Store Connect — `--no-push` skips registering local-only devices
  on Apple, `--no-pull` skips importing Apple-registered ones; it requires `--apple-team-id` or
  `--asc-api-key-id`. `--apple-team-id` is the internal team UUID, not the Apple Team Identifier.

## webhooks — event subscriptions

```bash
better-update webhooks list
better-update webhooks create --name <name> --url <https-url> --events <csv> [--project-id <id>]
better-update webhooks view <id>
better-update webhooks update <id> [--name <name>] [--url <url>] [--events <csv>] [--enable] [--disable]
better-update webhooks delete <id> [--yes]
```

Allowed `--events`: `update.published`, `build.completed` (comma-separated). `--project-id` restricts
a webhook to one project (omit for all). The **signing secret is returned once** at creation — store
it then; it can't be retrieved later. On `update`, `--enable` / `--disable` are two separate boolean
flags that set the enabled state.
