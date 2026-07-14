# Rollouts and rollbacks

There are **two** independent rollout systems plus a rollback command:

| Tool               | Granularity                               | When to use                                               |
| ------------------ | ----------------------------------------- | --------------------------------------------------------- |
| `update rollout`   | One update group, % of devices            | Every risky update. Default-on safety net.                |
| `channels rollout` | A channel, traffic split between branches | Migrating a channel from one branch to another gradually. |
| `update rollback`  | A whole branch, back to a prior point     | Something is broken in production right now.              |

## Update rollout (per-update %)

When you publish, pin the new update to a fraction of devices. The server hands the new manifest to
that fraction (deterministic per device) and the previous manifest to everyone else.

```bash
# Start partial
better-update update publish --branch production --rollout-percentage 10 --message "Risky cache migration"

# Ramp
better-update update rollout set <updateId> 25
better-update update rollout set <updateId> 50
better-update update rollout complete <updateId>     # sugar for → 100%

# Drop to zero (stops the spread)
better-update update rollout revert <updateId>       # → 0% for ONE update
better-update update revert-rollout <groupId>        # → 0% for EVERY update in a group
```

Devices that haven't pulled the update never will once reverted; devices already on it stay until
their next manifest check, then get the previous one. Percentages are **per-update**, not
per-channel — two updates on the same channel each keep their own rollout state. The most recent
update with non-zero rollout wins for selected devices; older updates stay served to the rest.

## Channel rollout (branch-level traffic split)

The migration tool — move an entire channel from one branch to another over time instead of a hard
cutover.

```bash
better-update channels rollout create <channelId> --branch release-2026-05 --percentage 10
#   add --runtime-version <version> to create to constrain the rollout to a single runtime version
better-update channels rollout update <channelId> --percentage 50
better-update channels rollout complete <channelId>     # channel now fully on the new branch
better-update channels rollout revert <channelId>       # channel back on the old branch
```

See `channels-and-branches.md` for the bigger picture.

## Rollback (whole-branch revert)

To get production off a bad update _now_, use `rollback`. It creates a special update group that
tells `expo-updates` to revert to the **embedded bundle** (the one shipped in the native build) — no
new bundle is uploaded. On devices, the next manifest check returns a "rollback to embedded"
directive; the runtime clears its cached OTA bundle and falls back to what shipped inside the binary.

```bash
better-update update rollback --branch production --message "Revert e7f3 — login crash"
```

### Roll back only updates after a point

```bash
better-update update rollback --branch production \
  --commit-time 2026-05-06T14:00:00.000Z --message "Revert anything after 2pm"
```

Updates published _before_ `--commit-time` remain served. **`--commit-time` must be canonical
ISO 8601 with milliseconds and a trailing `Z`** (`2026-05-06T14:00:00.000Z`) — the value is
normalized to this exact form before sending, because the on-device `expo-updates` client only parses
`YYYY-MM-DDTHH:mm:ss.SSSZ`. Forms with no milliseconds or numeric timezone offsets make the device
reject the rollback.

### Platform-scoped

```bash
better-update update rollback --branch production --platform ios --message "iOS-only revert"
```

Defaults to `--platform all`. `rollback` also takes `--environment <name>` (default `production`) and
`--private-key-path <path>` to code-sign the rollback directive (mutually exclusive with the
`--*-file` options). **`update roll-back-to-embedded`** is an EAS-parity alias with the same flags.

## Three different "revert" verbs

Don't confuse them:

| Command                                                        | Scope                     | Effect                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `update rollout revert <updateId>`                             | one update                | sets that update's rollout to 0%                                                                                                                                                                                                                                                   |
| `update revert-rollout <groupId>`                              | one group                 | sets every update in the group to 0%                                                                                                                                                                                                                                               |
| `update revert [--branch <name>] [--type published\|embedded]` | latest update on a branch | undoes the most recent update — `published` republishes the previous group, `embedded` publishes a rollback-to-embedded directive (interactive when flags omitted)                                                                                                                 |
| `update revert --group <groupId>`                              | one group (by id)         | non-interactive (EAS `update:rollback [GROUP_ID]` parity): the group must be the **latest** for its branch + runtime version; republishes the group before it, or publishes a rollback-to-embedded directive when it is the only one. Cannot be combined with `--branch`/`--type`. |

## Decision table: symptom → action

| Symptom                                           | Use                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------ |
| Risky publish, want to validate on a small slice  | `update publish --rollout-percentage 5`, then ramp.                |
| Bad update detected during a partial rollout      | `update rollout revert` — stops the spread.                        |
| Bad update at 100%, install count modest          | Repoint the **channel** at the previous branch.                    |
| Bad update at 100%, hard crash, want clean state  | `update rollback --branch <name>` — devices fall back to embedded. |
| Migrating a channel onto a new branch over a week | `channels rollout create … --percentage 10`, ramp, complete.       |
| Native regression (only fixable with a new build) | `update rollback` + ship a new app-store build with the fix.       |

## After a rollback

1. Investigate root cause before re-publishing from the same branch.
2. Publish the fix with `--rollout-percentage 10` to validate on a slice first.
3. The audit log records every publish, rollout change, and rollback:
   `better-update audit-logs list --resource-type update --limit 50`.

## Re-promote after a false alarm

The "repoint the channel" rollback doesn't delete anything. If the rollback was unnecessary, just
point back — only a pointer changed:

```bash
better-update channels update <channel-id> --branch <originally-suspect-branch>
```
