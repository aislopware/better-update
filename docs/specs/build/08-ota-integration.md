# 8. OTA Integration

## Overview

The build registry and OTA update system share a critical contract: **runtimeVersion**. A native binary built with runtimeVersion `X` only loads OTA updates published with the same runtimeVersion `X`. better-update tracks this relationship to show users which builds are compatible with which update channels.

## runtimeVersion Contract

```
Native binary (runtimeVersion embedded at build time)
    ↕ must match
OTA update (runtimeVersion set at publish time)
```

When a device launches:

1. The `expo-updates` client reads `runtimeVersion` from the embedded native config
2. Sends `GET /manifest/:projectId` with `expo-runtime-version: X` header
3. Server returns the latest update matching runtimeVersion `X` on the device's channel
4. If no matching update exists, the device keeps running its embedded bundle

## runtimeVersion Policies

Users configure the runtimeVersion policy in `app.json`. This determines when the runtimeVersion changes:

| Policy            | Value source                    | Changes when                           |
| ----------------- | ------------------------------- | -------------------------------------- |
| `"appVersion"`    | `expo.version`                  | Manual version bump                    |
| `"nativeVersion"` | `buildNumber` / `versionCode`   | Manual build number bump               |
| `"fingerprint"`   | Hash of native-impacting config | Any native dependency or config change |
| Static string     | Literal (e.g., `"1.2.0"`)       | Manual change                          |

**Recommendation**: `"fingerprint"` for automated pipelines. It changes automatically when native modules or config plugins change, preventing OTA/native incompatibility.

## Build Upload: runtimeVersion Required

When uploading a build, the `runtimeVersion` field is required for OTA tracking. The CLI resolves it before upload based on the configured policy:

### Resolution Logic per Policy

| Policy            | CLI resolution                          | Command                                                                                       |
| ----------------- | --------------------------------------- | --------------------------------------------------------------------------------------------- |
| `"fingerprint"`   | Compute native project fingerprint hash | `npx @expo/fingerprint .`                                                                     |
| `"appVersion"`    | Read `expo.version` from app config     | `npx expo config --json \| jq -r '.version'`                                                  |
| `"nativeVersion"` | Read platform-specific build number     | iOS: `expo.ios.buildNumber`, Android: `expo.android.versionCode` via `npx expo config --json` |
| Static string     | Read the literal value directly         | `npx expo config --json \| jq -r '.runtimeVersion'`                                           |

**Note**: `jq -r '.expo.runtimeVersion' app.json` only works for static string policies. For `appVersion`, `nativeVersion`, and `fingerprint` policies, the runtimeVersion is **computed** — it is not a literal value in `app.json`. The CLI must use the appropriate resolution command for each policy type.

```bash
# Fingerprint policy
RUNTIME_VERSION=$(npx @expo/fingerprint .)

# Static string policy (literal value in app.json)
RUNTIME_VERSION=$(npx expo config --json | jq -r '.runtimeVersion')

# appVersion policy (computed from expo.version)
RUNTIME_VERSION=$(npx expo config --json | jq -r '.version')

# Step 1: Reserve build + get presigned upload URL
RESPONSE=$(curl -s -X POST \
  -H "Authorization: Bearer $BETTER_UPDATE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"projectId\": \"uuid\",
    \"platform\": \"ios\",
    \"profile\": \"production\",
    \"distribution\": \"app-store\",
    \"runtimeVersion\": \"$RUNTIME_VERSION\",
    \"appVersion\": \"1.2.0\",
    \"buildNumber\": \"42\",
    \"bundleId\": \"com.example.app\",
    \"artifactFormat\": \"ipa\"
  }" \
  https://updates.example.com/api/builds)

BUILD_ID=$(echo $RESPONSE | jq -r '.id')
UPLOAD_URL=$(echo $RESPONSE | jq -r '.uploadUrl')

# Step 2: Upload artifact directly to R2 via presigned URL
curl -X PUT -H "Content-Type: application/octet-stream" \
  --data-binary @build/MyApp.ipa "$UPLOAD_URL"

# Step 3: Finalize build
SHA256=$(shasum -a 256 build/MyApp.ipa | cut -d' ' -f1)
SIZE=$(stat -f%z build/MyApp.ipa)
curl -X POST \
  -H "Authorization: Bearer $BETTER_UPDATE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"sha256\": \"$SHA256\", \"byteSize\": $SIZE}" \
  "https://updates.example.com/api/builds/$BUILD_ID/complete"
```

## Compatibility Matrix

The dashboard shows a matrix view per project — which builds work with which OTA channels.

### Query

```sql
-- Builds with their compatible update counts per active channel
-- Excludes paused channels and respects branch mapping
SELECT
    b.id AS build_id,
    b.platform,
    b.runtime_version,
    b.app_version,
    b.build_number,
    c.name AS channel_name,
    c.is_paused,
    COUNT(u.id) AS update_count
FROM builds b
LEFT JOIN channels c ON c.project_id = b.project_id
    AND c.is_paused = 0
LEFT JOIN branches br ON br.id = c.branch_id
LEFT JOIN updates u ON u.branch_id = br.id
    AND u.runtime_version = b.runtime_version
    AND u.platform = b.platform
WHERE b.project_id = ?
GROUP BY b.id, c.id
ORDER BY b.created_at DESC;
```

**Note**: This query covers the primary branch link. Channels with active branch rollouts (non-null `branch_mapping_json`) may also serve updates from a secondary branch — the dashboard should indicate this with a "rollout active" badge rather than trying to compute exact update counts for both branches.

### Dashboard View

```
/projects/:projectId (builds × channels tab)

runtimeVersion    Builds                    Channels
──────────────────────────────────────────────────────────
abc123def...      #42 iOS production        production: 3 updates ✓
                  #41 Android production    production: 3 updates ✓
                                            staging: 1 update ✓

xyz789ghi...      #40 iOS preview           staging: 0 updates ⚠
                  #39 Android preview       staging: 0 updates ⚠

old111...         #35 iOS production        (no active channel)
                  #34 Android production    (no active channel)
```

Status indicators:

- **✓** Channel has updates for this runtimeVersion
- **⚠** Channel exists but no updates for this runtimeVersion (OTA not active yet)
- No entry: channel linked to a branch with no updates for this runtimeVersion

### Build Detail: Compatible Channels

On the build detail page, show which channels can deliver OTA updates to this build:

```
Build #42 — iOS production
  runtimeVersion: abc123def...

  Compatible channels:
    ✓ production — 3 updates (latest: "Fix login bug", 2h ago)
    ✓ staging — 1 update (latest: "Add analytics", 1d ago)
    ✗ preview — no updates for this runtimeVersion
```

### Channel Detail: Compatible Builds

On the channel detail page, show which builds will receive updates from this channel:

```
Channel: production → branch: main

  Compatible builds:
    #42 iOS v1.2.0 (42) — runtimeVersion abc123def... — 2h ago
    #41 Android v1.2.0 (12) — runtimeVersion abc123def... — 2h ago
    #35 iOS v1.1.0 (35) — runtimeVersion old111... — 2w ago (no updates)
```

## OTA Config in Native Binary

The user configures `updates.url` in `app.json` to point to their better-update server. This is embedded in the native binary during `expo prebuild`:

```json
{
  "expo": {
    "updates": {
      "url": "https://updates.example.com/manifest/<projectId>",
      "enabled": true
    },
    "runtimeVersion": {
      "policy": "fingerprint"
    }
  }
}
```

**No Expo server involvement** — the expo-updates client calls better-update directly.

## Typical Workflow

```
1. Developer adds a native module (e.g., expo-camera)
   → runtimeVersion changes (fingerprint policy)
   → Must create new native build

2. Build locally: npx expo prebuild && xcodebuild ...
   → Upload to better-update: POST /api/builds
   → Build #43 with runtimeVersion "xyz789..."
   → Submit to App Store / distribute via ad-hoc

3. Developer fixes a JS bug (no native changes)
   → runtimeVersion stays the same
   → Publish OTA update to "production" channel
   → Devices running Build #43 receive the fix immediately

4. Repeat step 3 — no new builds needed until next native change
```

## Future: Auto-Detect Stale Builds

When a new runtimeVersion appears in OTA updates but no build exists for it, the dashboard can warn:

```
⚠ runtimeVersion "new123..." has 2 updates on "production" channel
  but no builds uploaded. Devices cannot receive these updates
  without a matching native build.
```

This helps catch the scenario where someone publishes an OTA update after a native change without building a new binary.
