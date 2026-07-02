# Access control, devices, and webhooks

This reference covers the organization-management surfaces: IAM (the managed admin policy + custom
policies + groups), Apple device registration, and webhook subscriptions.

## Access model

Authorization is **default-deny**: members and robots get **no** permissions from a role string.
Three tiers:

- **Owner** — org root (set at org creation), bypasses policy evaluation.
- **Admin** — attach the single managed policy `managed:admin` (full org administration).
- **Everything else** — **custom policies** (allow/deny statements with path-glob selectors),
  attached directly or via groups. A plain member holds only the baseline: org + environment-name
  reads.

**Protected environments** (default: `production`) only accept writes from principals holding
`environment:update` on them — Admins, Owner, or a custom grant (e.g. `environment:update` on
`project/*/env/production` = "production publisher"). Toggle protection in the dashboard
(Environment variables → Environments) or via the API.

**Apple credentials are scoped by Apple team.** Paths are
`appleTeam/{APPLE_TEAM_ID}/credential[/{id}]` where `APPLE_TEAM_ID` is the 10-char portal
identifier, so ONE selector covers every credential type of a team (distribution/push/pass-type/pay
certificates, push keys, provisioning profiles, ASC API keys):

```json
// "jmango360-apple-admin" — full CRUD + download on one team's credentials
{ "statements": [{ "effect": "allow", "actions": ["appleCredential:*"], "resources": ["appleTeam/JMANGO1234"] }] }
// "jmango360-apple-view" — read-only (add "appleCredential:download" to allow decrypt-download)
{ "statements": [{ "effect": "allow", "actions": ["appleCredential:read"], "resources": ["appleTeam/JMANGO1234"] }] }
```

Credential lists (and the Teams view) filter to the credentials the principal can read (a per-item,
deny-aware filter: a team-wide allow surfaces all of a team's credentials, an item-level deny hides
just that one). ASC keys not linked to a team live under `appleTeam/none` — grant `appleTeam/*` to
cover them. Note the IAM grant gates the API only: decrypting credential blobs still requires vault
access (E2E).

**Android + iOS credentials are scoped by project.** iOS bundle configs / app metadata and Android
application identifiers + build-credential groups gate at `project/{projectId}` — grant
`androidCredential:*` / `iosBundleConfiguration:*` on a project to cover just that project. (Android
upload keystores and Google service-account keys are org-shared secrets, so they stay org-level;
grant on `*` or `org` to manage them.)

**Group membership is a privilege delta.** Adding a member to a group grants them everything the
group's policies confer, so `addMember`/`removeMember` and `detach` are boundary-checked: a non-owner
can only change membership of (or detach) policies that grant nothing beyond what they themselves
hold. This blocks self-escalation into a group that carries `managed:admin`. Lists for channels,
branches, and updates also filter to the environments the caller can read, so an environment-scoped
grant sees its own items instead of an empty page.

```
policy (allow/deny statements) ──attach──► group ──membership──► member / robot
```

### policies

IAM policy documents.

```bash
better-update policies list
better-update policies create --name <name> --document <json> [--description <text>]
better-update policies update <id> [--name <name>] [--description <text>] [--document <json>]
better-update policies delete <id> [--yes]
```

`--document` is JSON, shape-validated client-side:

```json
{ "statements": [{ "effect": "allow", "actions": ["update:create"], "resources": ["project/*"] }] }
```

Each statement has `effect` (`allow`|`deny`), `actions`, and `resources` (path-glob scoped). There are
read-only **managed presets** referenced as `managed:<name>` (e.g. `managed:admin`) — they appear in
`list` but cannot be updated or deleted.

### groups

```bash
better-update groups list
better-update groups create --name <name> [--description <text>]
better-update groups update <id> [--name <name>] [--description <text>]
better-update groups delete <id> [--yes]                     # also sweeps memberships + policy attachments

better-update groups members list <id>
better-update groups members add <id> --member-id <memberId>
better-update groups members remove <id> --member-id <memberId>

better-update groups policies <id>                           # list policies attached to the group
better-update groups attach <id> --policy-id <policyId>      # accepts a real id OR a managed preset (e.g. managed:admin)
better-update groups detach <id> --policy-id <policyId>
```

Typical setup: create a group → attach a policy (custom or `managed:*`) → add members. They inherit
the group's permissions immediately.

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
