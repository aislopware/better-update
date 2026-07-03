# Publishing updates

A "publish" creates a new **update group** — a JS bundle plus its assets — and registers it under a
**branch** for a specific runtime version. Devices on a channel that points at that branch (with a
matching runtime version) pick it up on their next manifest check.

```
  publish ──► branch ◄── channel ──► device
```

You publish to a _branch_. A _channel_ points at a branch. Devices read the channel baked into their
build and fetch from the manifest URL in `app.json`.

## Prerequisites

- Logged in: `better-update login`.
- Project linked: `better-update init` (writes `projectId` into `app.json`).
- A branch to publish to: `better-update branches create --name main`.

## Basic publish

```bash
better-update update publish --branch main --message "Fix login crash on iOS 17"
```

The CLI runs `expo export` internally, hashes every output, uploads to the server (which streams to
R2 via presigned URLs), and registers the update group. **You do not run `expo export` yourself.**
Typical output:

```
✓ Exported (4.2s)
✓ Uploaded 1 bundle, 23 assets (3.1s)
✓ Update group e7f3… published to branch main
```

## All `update publish` flags

| Flag                                    | Default      | Notes                                                                                                                                          |
| --------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `--branch <name>`                       | —            | Target branch. Must already exist.                                                                                                             |
| `--channel <name>`                      | —            | Route via a channel name (resolves to its branch) instead of `--branch`.                                                                       |
| `--platform <ios\|android\|all>`        | `all`        | Restrict the publish to one platform.                                                                                                          |
| `--message <text>`                      | —            | Free-form description. Shows in the console + audit log.                                                                                       |
| `--environment <name>`                  | `production` | Which env-var environment to inject during export (default from `--profile`).                                                                  |
| `--profile <name>`                      | —            | eas.json build profile: its `environment` picks the scope and its `env` block overlays the server vars (profile wins) — same merge as `build`. |
| `--auto`                                | off          | Skip all interactive prompts (use in CI).                                                                                                      |
| `--clear`                               | off          | Drop existing assets before upload (full re-upload).                                                                                           |
| `--rollout-percentage <1-100>`          | —            | Initial update-level rollout. Omit for 100%.                                                                                                   |
| `--input-dir <path>`                    | —            | Publish a pre-built `expo export` dir (pair with `--skip-bundler`).                                                                            |
| `--skip-bundler`                        | off          | Don't run `expo export`; requires `--input-dir`.                                                                                               |
| `--emit-metadata`                       | off          | Write `eas-update-metadata.json` after publishing.                                                                                             |
| `--no-bytecode`                         | off          | Disable Hermes bytecode (emit raw JS).                                                                                                         |
| `--source-maps`                         | off          | Emit JS source maps.                                                                                                                           |
| `--private-key-path <path>`             | —            | RSA PEM to code-sign the rendered manifest (reads the cert from `app.json`).                                                                   |
| `--allow-dirty`                         | off          | Proceed with uncommitted git changes.                                                                                                          |
| `--patch-base-window <n>`               | `10`         | Max recent updates to bsdiff-patch against (`0` = embedded baseline only).                                                                     |
| `--no-patches`                          | off          | Skip bsdiff patch generation (on by default).                                                                                                  |
| `--manifest-body-file <path>`           | —            | Pre-built signed manifest body (both platforms).                                                                                               |
| `--signature-file <path>`               | —            | Pre-built signature for the manifest body.                                                                                                     |
| `--certificate-chain-file <path>`       | —            | Cert chain that signed it.                                                                                                                     |
| `--manifest-body-file-ios` / `-android` | —            | Per-platform override (same trio of `*-file-{ios,android}`).                                                                                   |

The `*-file-{ios,android}` variants exist when you want a different signed payload per platform.

## Runtime version

The CLI reads `runtimeVersion` from `app.json` (or computes it via the configured policy) and stores
it on the update. **Manifests are only served to devices whose installed binary advertises a matching
runtime version.** If no installed build matches, no device receives the update — verify with
`better-update fingerprint generate` and `better-update builds compatibility-matrix`.

Policies:

- **appVersion** — compatible with builds sharing `app.json` `version`. Bump `version` whenever you
  change native code.
- **nativeVersion** — `app.json` `version` combined with the native build number (Android
  `versionCode` / iOS `buildNumber`). Bump the version or the build number when native code changes.
- **fingerprint** — a hash of native sources (`ios/`, `android/`, native deps). Same hash → same
  runtime. Recommended for projects with custom native code.
- **sdkVersion** — tied to the Expo SDK major. Only safe for Expo-Go-style apps without custom native
  modules.

## Single-platform publish

```bash
better-update update publish --branch main --platform ios --message "iOS-only WebView fix"
```

## Promote an update across channels

Publish once to staging, promote to production after QA — no re-export, no second upload:

```bash
better-update update publish --branch staging --message "v1.4 candidate"
better-update update list --branch staging --limit 1        # get its id
better-update update promote <updateId> --channel production
```

`promote` creates a new update record on the target channel that references the **same** bundle and
assets — no extra bytes for devices to download. It accepts the same
`--manifest-body-file` / `--signature-file` / `--certificate-chain-file` flags for a separately
signed payload.

## Inspect & edit

```bash
better-update update list --branch main --platform ios --limit 20 --offset 1   # paginated list
better-update update view <updateId>                                           # one update: branch, platform, runtime, rollout %, rollback?, message
better-update update edit [groupId] --rollout-percentage 50                     # set the rollout % for a whole group (interactive picker if no id)
```

`update list` shows size, R2 keys, signing status, and (where wired) install counts. The web console
mirror is **Project → Updates**.

## Republish (flexible cross-target copy)

`promote` targets a channel; **`republish`** is the general form — copy any update (by group, update,
branch, or channel) to another branch or channel, preserving the runtime version, no re-upload:

```bash
better-update update republish --branch staging --to-channel production [--rollout-percentage 10]
better-update update republish --update <updateId> --to-branch <branchId> --platform ios
```

Exactly one source (`--group`/`--update`/`--branch`/`--channel`) and one destination
(`--to-branch`/`--to-channel`) are required.

## Audit log

Every publish, promote, rollback, and rollout change is recorded with actor, timestamp, and diff:

```bash
better-update audit-logs list --limit 50
better-update audit-logs list --resource-type update --from 2026-05-01 --to 2026-05-07
```

## Related

- Routing model and channel management → `channels-and-branches.md`
- Staged delivery and instant revert → `rollouts-and-rollbacks.md`
- Server-side env vars injected at publish → `environments.md`
