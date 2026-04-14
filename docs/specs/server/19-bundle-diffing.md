# 19. Delta Patch Flags

## Status

Delta patch delivery via `bsdiff` is intentionally unsupported in the self-hosted
`better-update` server.

## Client Behavior

Expo clients may still be configured with:

- `updates.enableBsdiffPatchSupport`
- `EXUpdatesEnableBsdiffPatchSupport`
- `expo.modules.updates.ENABLE_BSDIFF_PATCH_SUPPORT`
- `expo-current-update-id`

The server ignores those patch-specific hints and always serves the standard manifest
shape with full asset URLs.

## Server Behavior

- No patch metadata is included in manifest extensions.
- No patch files are generated or served.
- Standard manifest caching applies even when `expo-current-update-id` is present.

## Rationale

This keeps the self-hosted implementation smaller and more predictable. Full-asset
delivery remains the only supported OTA update path.
