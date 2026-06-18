# Channels and branches

better-update splits "what version is this" from "who gets it":

- A **branch** is a stream of updates. You publish _to_ a branch. Branches are server-side; they
  need not match git branches. They are flat — no parents, no merging — each one a sequence of
  update groups.
- A **channel** is what a built app reads. A channel points at _one_ branch at a time. Change the
  pointer and every device on that channel switches — no rebuild.

The indirection lets you ship a release candidate, vet it, and move all of production onto it with
one command.

## New branch vs new channel

| You want to…                                           | Do this                                                    |
| ------------------------------------------------------ | ---------------------------------------------------------- |
| Cut a release candidate, then promote to prod after QA | New **branch** (e.g. `release-v1.4`); promote later.       |
| Ship a feature flag for one tester group               | New **channel** (e.g. `internal`) wired into a beta build. |
| Roll back to a known-good update                       | Repoint the **channel** at the previous branch.            |
| Long-lived environment (staging, preview, prod)        | One **channel** per environment, each with its own branch. |

## Branches

```bash
better-update branches list
better-update branches view <id|name>                  # id, name, project, update count, created
better-update branches create --name release-v1.4
better-update branches rename <id> --name release-v1-4
better-update branches delete <id>
```

`branches view` accepts either a branch ID or a name. Publish to a branch with
`update publish --branch <name>` (see `publishing.md`).

## Channels

Each channel has: a name (e.g. `production`), a `branchId` it points at, a `paused` flag (paused
channels stop serving new manifests), and an optional in-progress branch rollout.

```bash
better-update channels list                                  # ID, name, branch, paused, rollout, created
better-update channels view <id|name>                        # one channel (+ cache version)
better-update channels create --name production --branch main
better-update channels update <id> --branch release-v1.4     # REPOINT (there is no `channels point`)
better-update channels pause <id>
better-update channels resume <id>
better-update channels delete <id>
better-update channels insights <name> [--period <1d|7d|30d|90d>]   # adoption/traffic for a channel
```

> There is **no `channels point` command.** Use `channels update <id> --branch <name>` to relink.
> `channels insights <name>` is the quick per-channel adoption view; `analytics channels --channel
<name>` is the equivalent under the analytics group.

## How a device picks a channel

The channel is set at **build time**, not runtime. Set the channel name in the build configuration
(`eas.json` profile or a custom build profile). After the build, the app fetches manifests for that
channel only — it cannot change without a new native build. This is why you create channels once per
environment and then move them between branches with `channels update`. You never recompile to change
which update is served.

## Worked example: cut, vet, promote

```
1. production → main          (engineering merges into `main` all week)

2. Cut an RC on a new branch:
   better-update branches create --name release-2026-05
   better-update update publish --branch release-2026-05 --message "RC for May release"

3. Wire staging to it for QA:
   better-update channels update <staging-channel-id> --branch release-2026-05
   → staging    → release-2026-05
     production → main

4. After QA passes, repoint production:
   better-update channels update <production-channel-id> --branch release-2026-05
   → staging    → release-2026-05
     production → release-2026-05

5. If something breaks, point production back:
   better-update channels update <production-channel-id> --branch main
```

Nothing is destroyed at any step — only a pointer moves.

## Channel rollout: gradual branch migration

A channel rollout sends a **percentage** of the channel's traffic from its current branch to a _new_
branch, then ramps. It's how you migrate an entire channel onto a new branch without a hard cutover.

```bash
better-update channels rollout create <channel-id> --branch release-2026-05 --percentage 10 [--runtime-version <rtv>]
better-update channels rollout update <channel-id> --percentage 50
better-update channels rollout complete <channel-id>     # new branch becomes the canonical pointer
better-update channels rollout revert <channel-id>       # everything back to the old branch
```

Channel rollouts are **branch-level traffic splits**. Update rollouts (`rollouts-and-rollbacks.md`)
are **per-update percentages**. They compose: ramp a channel onto a new branch to 100% while
individual updates inside that branch each carry their own rollout percentage.

## Coverage check

```bash
better-update builds compatibility-matrix
```

Shows which runtime versions each channel currently covers and flags channels with missing builds.
Run before a publish if unsure whether any device will actually receive it.
