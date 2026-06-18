# Access control, devices, and webhooks

This reference covers the organization-management surfaces: IAM (policies + groups), Apple device
registration, and webhook subscriptions.

## IAM model

Authorization is **default-deny**: members and API keys get **no** permissions from a role string or
an api-key admin fallback. Permissions come _only_ from explicitly attached **policies**. You attach
policies to **groups**, and members of a group inherit them.

```
policy (allow/deny statements) ──attach──► group ──membership──► member / api-key
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
{ "statements": [{ "effect": "allow", "actions": ["update:publish"], "resources": ["project/*"] }] }
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
