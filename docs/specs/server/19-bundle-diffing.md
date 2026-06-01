# 19. Bundle Diffing (bsdiff Content Negotiation)

## Status

Supported. The server serves precomputed `bsdiff` delta patches for the launch
bundle when the client advertises support, falling back to the full bundle
otherwise. This supersedes the previous "intentionally unsupported" status.

Verified against `expo/expo @ sdk-56` (`FileDownloader.kt` + `CHANGELOG.md`):

- **56.0.0** — patch content-negotiation headers.
- **56.0.6** — runtime-version header on asset requests.
- **56.0.14** — bsdiff-based patch downloads enabled by default; Android zstd
  decompression in `FileDownloader`.

See also `docs.expo.dev/eas-update/bundle-diffing` and PR `expo/expo#34453`.

## Protocol

bsdiff uses RFC 3229 ("Delta encoding in HTTP", Instance Manipulation) semantics
on the **launch-bundle download request**, not the manifest request. The manifest
itself carries no patch fields; negotiation happens entirely on the subsequent
bundle GET.

To make this possible the manifest's `launchAsset.url` points at a **Worker-served
bundle route** instead of the raw CDN URL, so the Worker can see the A-IM headers:

```
GET /manifest/{projectId}/bundle/{updateId}/{hash}
```

(`hash` is informational — the launch asset is resolved by `updateId`; it keeps
the URL content-addressed and cacheable. Non-launch assets keep their CDN URLs
since they are never patched.)

### Request headers (client → Worker, case-insensitive)

| Header                     | Meaning                                                                 |
| -------------------------- | ----------------------------------------------------------------------- |
| `a-im: bsdiff`             | RFC 3229 Accept-Instance-Manipulation. Absent ⇒ no patch ⇒ full bundle. |
| `expo-current-update-id`   | Currently-launched update on device (candidate patch base).             |
| `expo-embedded-update-id`  | Update embedded in the binary at build time (candidate patch base).     |
| `expo-requested-update-id` | The patch target (the update id from the manifest just served).         |
| `expo-runtime-version`     | Runtime version (sent on asset requests since 56.0.6). Scopes lookup.   |
| `expo-platform`            | `ios` \| `android`.                                                     |

### Response headers (Worker → client, when serving a patch)

| Header                | Meaning                                           |
| --------------------- | ------------------------------------------------- |
| `im: bsdiff`          | RFC 3229 IM header — body is a bsdiff patch.      |
| `expo-base-update-id` | The base update the patch was computed against.   |
| `content-type`        | `application/octet-stream` (patch + full bundle). |

When serving the full bundle (fallback), `im` and `expo-base-update-id` are
**omitted** and the body is the full bundle bytes. This is the backward-compatible
behavior; signing is unaffected because the signed manifest still lists the full
launch-asset hash and `bspatch` reconstructs identical bytes.

## Patch selection

The Worker probes candidate base ids in order — `[expo-current-update-id,
expo-embedded-update-id]` — and serves the first precomputed patch present in R2,
else the full bundle. Self-patches (base == target) and duplicates are dropped.
Selection logic is pure (`protocol/patch-negotiation.ts`); R2 reads live in
`repositories/bundle.ts`; orchestration in `application/resolve-bundle.ts`; HTTP
wiring in `handlers/bundle.ts`.

## Runtime-version scoping (56.0.6)

Asset/bundle requests carry `expo-runtime-version`. The Worker validates it
against the requested update's runtime version:

- **absent** ⇒ valid (backward compat with pre-56.0.6 clients);
- **present + mismatch** ⇒ `404` (prevents cross-runtime patch/bundle confusion).

## R2 key scheme (all in `ASSETS_BUCKET`)

| Object             | Key                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------- |
| Precomputed patch  | `patches/{projectId}/{runtimeVersion}/{platform}/{fromUpdateId}__{toUpdateId}.bsdiff` |
| Full launch bundle | `assets/{launchAssetHash}` (existing layout, reused)                                  |

Patches are uploaded by the CLI at publish time. Update ids are lowercase uuids
matching the ids the client sends.

## Embedded-bundle baseline

To let the **first** post-install update be a patch, the embedded bundle must be a
valid patch base. The CLI publishes the embedded update through the normal
`assets.upload` + `POST /api/updates` flow with `isEmbedded: true`. This:

- registers a normal `updates` row (so it has a real update id);
- stores the launch asset under `assets/{hash}` (no new bundle key);
- sets `is_embedded = 1`. A partial unique index on
  `(branch_id, runtime_version, platform) WHERE is_embedded = 1` guarantees
  exactly one baseline per (runtime, platform); publishing a new one clears the
  previous flag inside the same serialized publish.

On first launch the embedded update **is** the launched/current update, so the
device sends it as `expo-current-update-id` (SDK-56 only patches against the
current update and rejects any patch whose `expo-base-update-id` is not that
current id). `selectPatchCandidates` therefore uses the **current** id to resolve
the first-launch patch key. `expo-embedded-update-id` is still parsed (for cache
`Vary`) but is never offered as a patch base.

## Cloudflare Compression Rule (ops)

zstd/gzip is **HTTP transport compression done at the Cloudflare edge** and decoded
by the Android `FileDownloader` (zstd as of 56.0.14). The Worker implements **no**
compression. It must:

1. set a compressible, rule-targetable `content-type: application/octet-stream` on
   bundle and patch responses; and
2. **never** set `content-encoding` on those responses — doing so marks the body
   as already-encoded and blocks the edge from compressing it.

Enable a zone **Compression Rule** that matches response `content-type`
`application/octet-stream` (bundle/patch) and emits zstd/gzip on supporting
clients. Manifest responses (`multipart/mixed`, `application/expo+json`) likewise
never set `content-encoding`.

> **Correctness requirement — must honor `Accept-Encoding`, never force `zstd`.**
> The device verifies each asset/bundle by recomputing the SHA-256 of the bytes its
> HTTP stack hands back, after transparent decompression. iOS `URLSession` decodes
> only `gzip`/`deflate`/`br` and **never advertises or decodes `zstd`**; Android
> decodes `zstd`/`br`/`gzip` but only because it adds `Accept-Encoding: zstd, br,
gzip` itself. So the Compression Rule (and the public R2 asset host,
> `ASSET_CDN_URL`, which serves non-launch assets **outside** the Worker route)
> MUST strictly negotiate on the request `Accept-Encoding` and MUST NOT emit
> `content-encoding: zstd` to a client that did not advertise it. A rule that
> force-encodes `zstd` would hand an iOS device a body it cannot decode → the
> recomputed hash never matches `launchAsset.hash`/`asset.hash` →
> `assetsFailedToLoad` → **every iOS update is rejected**. This dependency lives in
> dashboard/ops config, not the repo; pin it (infra-as-code) and verify with a
> deploy check that an `Accept-Encoding: gzip, br` request never receives
> `content-encoding: zstd`.
