# Handler Permission Scope Surface

Maps every `assertPermission(resource, action)` call site across
`apps/server/src/handlers/` to its future scoping category.

Legend:

- **CHANNEL-SCOPED** — must be converted to `assertPermissionOn("channel", channelId)` (or equivalent per-channel gate)
- **ORG-WIDE** — stays as-is; no per-channel dimension required

---

## Channel-scoped operations

These handlers mutate or gate access to a specific channel's state.
Each entry shows the exact file + line, the current check, and where
`channelId` is available at the point the check fires.

| File                   | Line | Current check                                              | channelId source                                                                                                                                                                                                                  |
| ---------------------- | ---- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `handlers/channels.ts` | 44   | `assertPermission("channel", "create")`                    | `payload.projectId` in body — no channelId yet (insert); scope by projectId → channel after creation; or accept that create is still org-level and only scope post-create mutations                                               |
| `handlers/channels.ts` | 80   | `assertPermission("channel", "read")`                      | `urlParams.projectId` in query param; lists channels for a project — stay project-scoped or add per-channel row filter                                                                                                            |
| `handlers/channels.ts` | 101  | `assertPermission("channel", "update")`                    | `path.id` = channelId directly in URL param; channel row fetched on next line                                                                                                                                                     |
| `handlers/channels.ts` | 135  | `assertPermission("channel", "update")` (pause)            | `path.id` = channelId                                                                                                                                                                                                             |
| `handlers/channels.ts` | 147  | `assertPermission("channel", "update")` (resume)           | `path.id` = channelId                                                                                                                                                                                                             |
| `handlers/channels.ts` | 159  | `assertPermission("rollout", "create")`                    | `path.id` = channelId                                                                                                                                                                                                             |
| `handlers/channels.ts` | 194  | `assertPermission("rollout", "update")` (update %)         | `path.id` = channelId                                                                                                                                                                                                             |
| `handlers/channels.ts` | 215  | `assertPermission("rollout", "update")` (complete)         | `path.id` = channelId                                                                                                                                                                                                             |
| `handlers/channels.ts` | 236  | `assertPermission("rollout", "update")` (revert)           | `path.id` = channelId                                                                                                                                                                                                             |
| `handlers/channels.ts` | 253  | `assertPermission("channel", "delete")`                    | `path.id` = channelId                                                                                                                                                                                                             |
| `handlers/updates.ts`  | 114  | `assertPermission("update", "create")` (publish)           | channelId NOT in payload; resolved via `coordinator.ensureBranchChannel` → `branchValue.channelId` after the check fires; must hoist channelId resolution before the gate or resolve via `ChannelRepo.findByProjectAndBranchName` |
| `handlers/updates.ts`  | 238  | `assertPermission("rollout", "update")` (update rollout %) | channelId not in path; update→branch→channels: must do `ChannelRepo.findByBranchId(update.branchId)` after fetching the update row (already done on line 241)                                                                     |
| `handlers/updates.ts`  | 416  | `assertPermission("update", "create")` (republish)         | destination channelId available via `resolveRepublishDestination` which returns `destinationChannel.id`; currently only `branchId` is surfaced from that helper — needs to also return `channelId`                                |
| `handlers/assets.ts`   | 131  | `assertPermission("update", "create")` (upload)            | `payload.projectId` in body; no channelId in upload — assets are uploaded before a branch/channel is chosen; channel is resolved at publish time; upload step is intentionally project-scoped                                     |
| `handlers/assets.ts`   | 225  | `assertPermission("update", "create")` (patch upload)      | `payload.projectId` in body; same as above — pre-publish, no channel yet                                                                                                                                                          |
| `handlers/assets.ts`   | 266  | `assertPermission("update", "create")` (finalize)          | no project/channel in path; asset is identified by hash only; no channel context available without additional lookup                                                                                                              |
| `handlers/branches.ts` | 38   | `assertPermission("branch", "create")`                     | `payload.projectId`; channel is not created here — project-scoped is correct; consider channel-scoped only if branch-to-channel mapping is created inline                                                                         |
| `handlers/branches.ts` | 103  | `assertPermission("branch", "update")` (rename)            | `path.id` = branchId; channelId requires `ChannelRepo.findByBranchId` lookup                                                                                                                                                      |

---

## Org-wide operations (stay unchanged)

These operations have no meaningful per-channel dimension; they remain
flat org-level permission checks.

| File                                          | Lines                                | Resource:Action                              | Rationale                                                                     |
| --------------------------------------------- | ------------------------------------ | -------------------------------------------- | ----------------------------------------------------------------------------- |
| `handlers/projects.ts`                        | 45, 121, 143, 154, 168, 189          | `project:create/read/update/delete`          | Project CRUD is org-scoped by definition                                      |
| `handlers/branches.ts`                        | 71, 92, 124                          | `branch:read/read/delete`                    | Branch list/get/delete scoped to project; no per-channel dimension            |
| `handlers/updates.ts`                         | 261, 286, 310, 323, 343              | `update:read`                                | Read operations: list, get, getGroup, listAssets — project/branch scoped      |
| `handlers/updates.ts`                         | 362                                  | `update:delete`                              | deleteGroup — scoped by branch→project; no specific channel                   |
| `handlers/env-vars.ts`                        | 49, 109, 155, 168, 224, 247, 270     | `envVar:*`                                   | Env vars are org or project scoped (with `environments` CSV), not per-channel |
| `handlers/org-vault.ts`                       | 80, 94, 144, 170, 185, 217, 253, 269 | `vaultAccess:*`                              | Vault is org-wide E2E; no channel dimension                                   |
| `handlers/user-encryption-keys.ts`            | 21, 50                               | `vaultAccess:read/create`                    | User keypair management, org-wide                                             |
| `handlers/google-service-account-keys.ts`     | 36, 47, 108, 130                     | `androidCredential:*`                        | Credential vault, org-wide                                                    |
| `handlers/asc-api-keys.ts`                    | 35, 46, 118, 140                     | `appleCredential:*`                          | Credential vault, org-wide                                                    |
| `handlers/apple-push-keys.ts`                 | 38, 49, 112, 134                     | `appleCredential:*`                          | Credential vault, org-wide                                                    |
| `handlers/apple-distribution-certificates.ts` | 38, 49, 122, 144                     | `appleCredential:*`                          | Credential vault, org-wide                                                    |
| `handlers/android-upload-keystores.ts`        | 37, 48, 110, 132                     | `androidCredential:*`                        | Credential vault, org-wide                                                    |
| `handlers/apple-provisioning-profiles.ts`     | 43, 59, 120, 145                     | `appleCredential:*`                          | Credential vault, org-wide                                                    |
| `handlers/android-build-credentials.ts`       | 24, 39, 80, 115                      | `androidCredential:*`                        | Credential vault, org-wide                                                    |
| `handlers/build-credentials.ts`               | 32, 58                               | `appleCredential/androidCredential:download` | Credential download, org-wide                                                 |
| `handlers/ios-bundle-configurations.ts`       | 23, 34                               | `iosBundleConfiguration:*`                   | Credential vault, org-wide                                                    |
| `handlers/android-application-identifiers.ts` | 22, 33, 79                           | `androidCredential:*`                        | Credential vault, org-wide                                                    |
| `handlers/devices.ts`                         | 43, 80, 104, 115, 156, 176, 219      | `device:*`                                   | Device registry, project-scoped (not per-channel)                             |
| `handlers/webhooks.ts`                        | (multiple)                           | `webhook:*`                                  | Webhook config is project-scoped                                              |
| `handlers/submissions.ts`                     | (multiple)                           | `submission:*`                               | Submission tracking, org-wide                                                 |
| `handlers/audit-logs.ts`                      | 16                                   | `auditLog:read`                              | Audit log read, org-wide                                                      |
| `handlers/analytics.ts`                       | 13, 31, 54, 73                       | `project:read`                               | Analytics read, project-scoped                                                |
| `handlers/builds.ts`                          | 139, 223, 306, 323, 336, 363, 406    | `build:*`                                    | Build pipeline, project-scoped; no channel involvement                        |
| `handlers/fingerprints.ts`                    | 18                                   | `build:read`                                 | Build artifact read, project-scoped                                           |
| `handlers/apple-teams.ts`                     | 15                                   | `appleCredential:read`                       | Apple team lookup, org-wide                                                   |

---

## Notes on manifest serve path

`handlers/manifest.ts` (`serveManifest`) has **no** `assertPermission` call — it is the
device-facing unauthenticated OTA protocol endpoint. Channel context (`channelName`, resolved
`branchId`, `channelId`) is fully available inside `serveRequest` via the repo call
`ManifestRepo.resolveChannel`. No changes needed for authz scoping.

---

## Conversion priority

1. **P0 — mutating channel state directly** (`channels.ts` update/pause/resume/delete/rollout\*):
   channelId = `path.id`, zero extra lookups needed.

2. **P1 — publishing an update to a channel** (`updates.ts` create):
   channelId resolved inside `coordinator.ensureBranchChannel`; surface it out of the DO
   coordinator response (already sets `branchValue.channelId`) so the gate can fire before
   any write.

3. **P2 — republish** (`updates.ts` republish + `update-republish.ts` destination):
   `resolveRepublishDestination` already fetches `destinationChannel`; add `channelId` to
   the returned object so the handler can gate.

4. **P3 — per-update rollout %** (`updates.ts` editRollout/completeRollout/revertRollout):
   Requires a `ChannelRepo.findByBranchId` lookup after the update row is fetched.

5. **P4 — branch rename** (`branches.ts` rename):
   Channel affects routing; scoping branch mutations per-channel is optional (branch ≠ channel).

6. **Intentionally project-scoped (no conversion)**: asset upload endpoints (`assets.ts`),
   branch create, channel create, channel list.
