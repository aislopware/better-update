---
name: better-update
description: >-
  Drive the better-update CLI (@better-update/cli, the `better-update` command) to ship OTA
  JS/asset updates, run local native iOS/Android builds, manage an end-to-end-encrypted
  signing-credential vault, set server-side env vars, and route releases through
  channels/branches with staged rollouts and instant rollback — for Expo, React Native,
  Kotlin Multiplatform, and native apps (any project type via custom build commands). Use this
  whenever you are working in a project that uses better-update (an
  `@better-update/cli` dependency, a `better-update …` command, `expo.extra.betterUpdate.projectId`
  in app.json, or an `updates.jmango360.dev` manifest URL), OR when the user asks to publish /
  ship an OTA update, stage a rollout or roll back a release, cut a release candidate, promote an
  update between channels, build an IPA/APK/AAB locally, manage keystores / distribution certs /
  provisioning profiles / APNs push keys, or configure per-environment secrets — even if they
  never say the words "better-update". Covers every command, every flag, and the
  publish → branch → channel → device routing model.
---

# better-update CLI

better-update is a self-hosted mobile release platform for Expo, React Native, Kotlin Multiplatform,
and native apps — any project type, including ones driven by a custom build command — running on
Cloudflare. It does OTA JS updates (Expo Updates protocol-compatible), local native builds (EAS
Build-compatible), an end-to-end-encrypted credential vault, server-side env vars, and store
submission — all driven from one CLI, `better-update`. This skill is how you operate that CLI on a
user's behalf.

## The one mental model that explains everything

```
  publish ──► branch ◄── channel ──► device
```

- You **publish** an update group (a JS bundle + its assets) **to a branch**. Branches are
  server-side streams of updates; they need not match git branches.
- A **channel** points at exactly **one branch at a time**. The channel a device reads is baked in
  **at build time** and cannot change without a new native build.
- A device on channel `X` fetches the latest compatible update from whatever branch `X` currently
  points at — _if_ its installed binary's **runtime version** matches the update's.

This indirection is the whole point: you ship a release candidate to a branch, vet it on a `staging`
channel, then repoint `production` at that branch with **one command — no rebuild**. Rollback is the
same move in reverse.

Two facts that prevent most mistakes:

1. **Channel ↔ branch is a pointer you move** (`channels update <id> --branch <name>`), not a
   recompile. There is **no `channels point` command**.
2. **A published update only reaches a device whose installed build advertises a matching runtime
   version.** Publish to a runtime no installed build matches → zero devices get it. Verify with
   `better-update builds compatibility-matrix`.

## Setup (do this before anything else)

```bash
bun add -g @better-update/cli      # or: bunx @better-update/cli <cmd>   (no install)
better-update login                # browser OAuth; --api-key for headless paste
better-update init                 # from the Expo project root: links app.json → a project
```

`login` writes `~/.better-update/auth.json` (mode `0600`). `init` reads `app.json`, finds/creates a
project by `expo.slug`, and writes the project id into `expo.extra.betterUpdate.projectId` — every
other command reads it from there. Default server is `https://updates.jmango360.dev`; override with
`BETTER_UPDATE_URL` / `BETTER_UPDATE_WEB_URL` or `~/.better-update/config.json`. Auth can also come
from `BETTER_UPDATE_TOKEN`. Full detail: **`references/getting-started.md`**.

To know whether a project already uses better-update, look for `@better-update/cli` in
package.json, `expo.extra.betterUpdate.projectId` in app.json, or an `updates.jmango360.dev`
manifest URL in `expo.updates.url`.

## Command map

```
better-update
├── login / logout / whoami   Auth + identity (token at ~/.better-update/auth.json, mode 0600)
├── init / status / doctor    Link project · status · diagnostics
├── open / autocomplete       Open the dashboard · print a shell completion script
├── projects                  list · create · get · rename · archive · unarchive · delete
├── branches                  list · view · create · rename · delete
├── update                    publish · list · view · edit · promote · republish · rollback ·
│                             revert · rollout(set/complete/revert) · revert-rollout ·
│                             roll-back-to-embedded · embedded:upload · configure · insights · delete
├── channels                  list · view · create · update(repoint) · pause · resume · delete · insights · rollout
├── build [+ configure]       Build the app locally and (by default) upload the artifact
├── builds                    list · get · download · run · install-link · compatibility-matrix · upload · resign · delete
├── credentials               Signing vault + E2E encryption (identity/access/device/unlock/lock);
│                             account/env-vault subcommands (or web self-enroll + grant) for browser env editing;
│                             certificate/bundle-id/profile/capability list+enable (read-only ASC inventory, CI-safe)
├── env                       Project env vars: list/get/set/update/delete/history/rollback/import/export/pull/push/exec
├── environments              Org environment definitions: list/create/rename/delete
├── fingerprint               generate · compare (runtime-compatibility hashes)
├── analytics                 adoption · updates · channels · platforms
├── audit-logs                list (every mutation, with actor + timestamp)
├── apple                     login · logout · whoami; builds · users (CI-safe); asc-key · sandbox (Apple ID login)
├── submit                    Submit a build to App Store Connect / Google Play
├── testflight                group · tester · review · build — full TestFlight beta lifecycle (CI-safe)
├── app-store                 version · submit/cancel/status/release/reject · rollout · review-detail · info · categories · age-rating · privacy · apps (list + create) · pricing · availability (show + set) · territories · config (pull/push) (CI-safe; apps create needs Apple ID login)
├── reviews                   list · reply — App Store customer reviews (CI-safe)
├── metadata                  media (list/sync) · screenshots (upload/clear) · previews (upload) — store media (CI-safe)
├── app-review                list · view · rejections · reply — Apple App Review / Resolution Center (Apple ID login, NOT CI-safe)
├── devices                   Register Apple device UDIDs for ad-hoc/development provisioning
├── groups / policies         IAM: member groups + policy documents (default-deny)
└── webhooks                  update.published / build.completed subscriptions
```

## Core workflows (the 90% cases)

**Ship a JS/asset update** — you do NOT run `expo export` first; `publish` does it for you:

```bash
better-update update publish --branch main --message "Fix login crash on iOS 17"
```

**Stage it to a slice, then ramp** (default-on safety net for risky changes):

```bash
better-update update publish --branch production --rollout-percentage 10 --message "Cache migration"
better-update update rollout set <updateId> 50
better-update update rollout complete <updateId>     # → 100%
better-update update rollout revert <updateId>       # → 0%, stops the spread
```

**Cut a release candidate, vet, promote** — no re-export, no second upload:

```bash
better-update update publish --branch staging --message "v1.4 candidate"
better-update update list --branch staging --limit 1          # grab its id
better-update update promote <updateId> --channel production   # or repoint the channel:
better-update channels update <prodChannelId> --branch staging
```

**Roll back production now** (devices fall back to the embedded bundle):

```bash
better-update update rollback --branch production --message "Revert e7f3 — login crash"
```

**Build a new native binary** (needed whenever native code / runtime version changes):

```bash
better-update build --platform ios --profile production
better-update builds compatibility-matrix     # confirm channels are covered before you publish OTA
```

**Per-environment server-side env vars**, injected into `expo export` at publish time:

```bash
better-update env set EXPO_PUBLIC_API_URL=https://api.example.com
better-update env set STRIPE_KEY=sk_live_xxx --visibility sensitive
better-update update publish --branch production --environment production
```

**Submit a build to the stores** (App Store Connect / Google Play), from the CLI:

```bash
better-update submit --platform ios --latest --what-to-test "Fixed the login crash and refreshed onboarding"
better-update build --platform android --auto-submit          # or build + submit in one step
```

## Gotchas worth memorizing

- **No `channels point`.** Repoint with `channels update <id> --branch <name>`.
- **Runtime version gates delivery.** Match builds and updates; use `fingerprint` +
  `builds compatibility-matrix` to verify before publishing.
- **The channel is build-time.** Set it in the build profile / `--release-channel`; it cannot be
  changed OTA. You move _branches under channels_, never recompile to change which update serves.
- **`--commit-time` for rollback must be canonical ISO 8601 with milliseconds and a trailing `Z`**
  (`2026-05-06T14:00:00.000Z`). The on-device `expo-updates` client only parses
  `YYYY-MM-DDTHH:mm:ss.SSSZ`; numeric offsets / missing millis are rejected.
- **Env-var visibility is `plaintext` or `sensitive` — there is NO `secret` tier.** Passing
  `--visibility secret` is rejected by the CLI. `sensitive` values are masked (`******`) on `env get`
  unless `--include-sensitive`, and readable in the console only by owners/admins; they are still
  returned by `env export`/`env pull`. Visibility gates _who on the team_ can read — it does not
  harden a value against device extraction (anything in a JS bundle is extractable; use a backend).
- **`env get <key>` and `env delete <key>` both take the KEY name** (not an ID). `env delete` with no
  `--environment` deletes the key across **every** environment.
- **`env pull` writes `.env.local` by default**, not stdout — use `--stdout` to source into a shell
  (`eval "$(better-update env pull --stdout)"`).
- **`update rollout`** is per-update %; **`channels rollout`** is a branch-level traffic split. They
  compose — you can ramp a channel onto a new branch while updates inside it have their own %.
- **better-update DOES submit to stores from the CLI.** `better-update submit --platform ios|android`
  uploads to App Store Connect (TestFlight via altool) or Google Play; `build --auto-submit` chains
  build → submit. (It does not poll store _review_ — only the upload/submission.)
- **`--what-to-test` has a length floor Apple won't document.** `submit` rejects empty or >4000-byte text
  before upload, but Apple also rejects _short_ strings ("too short" — e.g. `Fix`, and even `Bug fixes` in some
  reports) with no published minimum. Write a full sentence. If it trips after upload, fix it without
  re-uploading: `testflight build whats-new --latest --whats-new "<longer text>"`.
- **`submit` is idempotent — just re-run it after a metadata failure.** It checks App Store Connect for the
  IPA's build number before uploading; if the binary is already there it skips `altool` and only re-applies the
  TestFlight config (so the "already been used" duplicate-build error can't strand you). When the upload
  succeeds but config fails, the submission is still recorded as **metadata-incomplete** (dashboard shows amber
  "Metadata pending" vs green "Complete"); the re-run that completes config updates that same row.
- **App Store Connect operations run from the CLI, headless.** `testflight …` (group / tester / review / build),
  `app-store …` (version / submit / cancel / status / release / reject / rollout / review-detail / info /
  categories / age-rating / privacy / apps / pricing / availability), `apple builds`/`apple users`,
  `reviews …`, `metadata …` (store media), and the `credentials` ASC inventory (certificate / bundle-id /
  profile / capability) all drive App Store Connect with a stored ASC API key — no browser, CI-safe.
  `testflight group create` is the fix for a `submit ios` that fails with `TESTFLIGHT_GROUP_NOT_FOUND`.
  `apple builds compliance --no-uses-encryption` clears a build stranded in `MISSING_EXPORT_COMPLIANCE`.
  `app-store age-rating set` / `privacy set` are authored from a JSON document (`--from`), not a flag matrix.
  `metadata media sync` declaratively pushes a `screenshots/<locale>/<device>/*.png` tree (with `--dry-run` /
  `--prune`). `apple users` needs an Admin-role key. See `references/cli.md`.
- **A few App Store Connect ops are cookie-only (Apple ID login + 2FA, NOT CI-safe).** `app-review …`
  (Resolution Center: read App Review threads / rejection guideline codes / reply — text only), `apple asc-key
list` + `credentials revoke asc-key` (the upstream ASC-key lifecycle), `app-store apps create`, `credentials
bundle-id create --app-clip`, and `apple sandbox …` (IAP testers) all hit Apple's Iris API, which a JWT key
  can't reach — they log in via `apple login` and fail with a clear error under `--non-interactive` / CI. A
  rejected `app-store submit` is closed out with `app-review list` → `app-review rejections --thread <id>` →
  `app-review reply`.

## Reference index — read the file that matches the task

The depth lives in `references/`. Pull the one you need; don't load them all.

| Read this                              | When you're…                                                                                                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `references/getting-started.md`        | installing, logging in, pointing at a self-hosted server, linking a project, or using `whoami`/`doctor`/`open`                                                                             |
| `references/publishing.md`             | publishing updates, every `update publish` flag, runtime-version policies, promote/republish/edit, the audit log                                                                           |
| `references/channels-and-branches.md`  | new-branch-vs-channel, repointing channels, `view`/`insights`, the cut→vet→promote pattern, channel rollouts                                                                               |
| `references/rollouts-and-rollbacks.md` | staging a % rollout, the three "revert" verbs, whole-branch rollback, the symptom→action decision table                                                                                    |
| `references/native-builds.md`          | running `build` (+`configure`), managing `builds` (download/run/resign), `fingerprint`, store `submit`                                                                                     |
| `references/credentials.md`            | the signing + E2E credential vault: certs/profiles/keystores/APNs, `identity`/`access`/`device`, `unlock`/`lock`; `account`/`env-vault` for browser env-vault access + its troubleshooting |
| `references/environments.md`           | env vars (`set`/`get`/`push`/`pull`/`export`, visibility), `history`/`rollback`, the org `environments` command                                                                            |
| `references/access-control.md`         | IAM policies & groups, member access, Apple device registration, webhooks                                                                                                                  |
| `references/cli.md`                    | you need the exhaustive command/flag table for ANY command (every group), or exit codes for CI branching                                                                                   |

When a command's exact flags or exit-code semantics matter (especially in CI scripts), confirm
against `references/cli.md` — it mirrors `apps/cli/src/commands` and is the source of truth.
