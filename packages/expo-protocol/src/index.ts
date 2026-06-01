/**
 * Default number of recent (non-embedded) published updates a new bundle is
 * diffed against when computing bsdiff patch bases. Shared by BOTH ends so they
 * cannot drift: the CLI `publish` command uses it as the default
 * `--patch-base-window`, and the server OTA reaper uses it as the minimum number
 * of recent bases per tuple to protect from update/patch reaping. If the two
 * ever disagree, the reaper can delete a base the CLI pre-generated patches
 * against (degrading to a full-bundle fallback until regen).
 *
 * NOTE: `--patch-base-window` is a per-publish CLI flag and is NOT persisted
 * server-side, so the reaper cannot know a project that published with a LARGER
 * window. This constant only guarantees the DEFAULT window never drifts; a
 * project that intentionally publishes with a window > this value accepts that
 * bases ranked beyond it may be reaped (patches are regenerable). See
 * application/ota-reaper.ts PATCH_BASE_PROTECT_LIMIT.
 */
export const DEFAULT_PATCH_BASE_WINDOW = 10;

export const buildRollbackDirectiveBody = (commitTime: string): string =>
  JSON.stringify({
    type: "rollBackToEmbedded",
    parameters: {
      commitTime,
    },
  });

/**
 * Inputs that identify a single bsdiff patch. `fromUpdateId` is the base update
 * the device already has; `toUpdateId` is the update being fetched. Patches are
 * scoped to one (project, runtimeVersion, platform).
 */
export interface PatchKeyParams {
  readonly projectId: string;
  readonly runtimeVersion: string;
  readonly platform: string;
  readonly fromUpdateId: string;
  readonly toUpdateId: string;
}

/**
 * Deterministic R2 key for a precomputed bsdiff patch:
 * `patches/{projectId}/{runtimeVersion}/{platform}/{from}__{to}.bsdiff`.
 *
 * Update ids are lowercased to match the lowercased uuids expo-updates sends in
 * the `expo-*-update-id` headers. Shared by the server (which builds the key
 * server-side from the request tuple — never trusting a client-sent key) and the
 * CLI (which builds the same key to upload the patch + for skip/log detection),
 * so both ends agree byte-for-byte on where a patch lives.
 */
export const patchR2Key = (params: PatchKeyParams): string => {
  const from = params.fromUpdateId.toLowerCase();
  const to = params.toUpdateId.toLowerCase();
  return `patches/${params.projectId}/${params.runtimeVersion}/${params.platform}/${from}__${to}.bsdiff`;
};

/**
 * Pure validation that a string is a well-formed patch R2 key for the given
 * tuple. The server NEVER trusts a client-sent key — it builds the key itself
 * via {@link patchR2Key} — but this guard locks the produced key's shape so a
 * malformed tuple (path separators, traversal, empty segments) can never escape
 * the `patches/` prefix. Returns true iff `key` equals the canonical key for the
 * tuple AND every segment is a single safe path component.
 */
export const isValidPatchKey = (key: string, params: PatchKeyParams): boolean => {
  const segments = [
    params.projectId,
    params.runtimeVersion,
    params.platform,
    params.fromUpdateId,
    params.toUpdateId,
  ];
  // Reject anything that could break out of the patches/ prefix or inject an
  // extra path segment. `__` is the from/to separator and is allowed.
  const unsafe = segments.some(
    (segment) =>
      segment.length === 0 ||
      segment.includes("/") ||
      segment.includes("\\") ||
      segment.includes("..") ||
      segment.includes("\0"),
  );
  if (unsafe) {
    return false;
  }
  return key === patchR2Key(params);
};

/**
 * The Worker bundle route a manifest's `launchAsset.url` must point at so the
 * Worker — not the CDN — performs RFC-3229 / A-IM bsdiff content negotiation:
 * `${serverBaseUrl}/manifest/{projectId}/bundle/{updateId}/{hash}`.
 *
 * Shared by the server's unsigned manifest builder and the CLI's signed manifest
 * render/validation so both emit the byte-identical URL string. `hash` is the
 * launch asset's namespaced hash (the value used for URL routing), NOT the raw
 * content checksum.
 */
export const launchBundleUrl = (params: {
  readonly serverBaseUrl: string;
  readonly projectId: string;
  readonly updateId: string;
  readonly hash: string;
}): string =>
  `${params.serverBaseUrl}/manifest/${params.projectId}/bundle/${params.updateId}/${params.hash}`;

// -- Shared manifest render (byte-identical for CLI signer + server serve) ----

/**
 * Update-level fields a rendered manifest carries. Shared by the server's
 * unsigned manifest builder and the CLI's signed-manifest renderer so both ends
 * render byte-identical JSON.
 */
export interface ManifestUpdateData {
  readonly id: string;
  readonly createdAt: string;
  readonly runtimeVersion: string;
  readonly metadata: Record<string, unknown>;
  readonly extra: Record<string, unknown> | undefined;
}

/**
 * Asset-level fields a rendered manifest carries. `contentChecksum` is the raw
 * SHA-256 of the file bytes (the device verifies asset integrity against it);
 * `hash` is the namespaced dedup key used for URL routing to the R2 object.
 */
export interface ManifestAssetData {
  readonly key: string;
  readonly hash: string;
  readonly contentChecksum: string;
  readonly contentType: string;
  readonly fileExt: string;
  readonly isLaunch: boolean;
}

const assetUrl = (baseUrl: string, hash: string) => `${baseUrl}/assets/${hash}`;

// launchBundleUrl is shared with the server (see above): the launch bundle is
// served by the Worker (not the CDN) so it can perform bsdiff A-IM content
// negotiation, and the CLI's signed-manifest render must emit the byte-identical
// URL. Regular assets are not patched and keep their CDN URLs.

// The manifest `hash` field MUST be the raw-SHA-256 base64url-no-pad
// `contentChecksum` of the asset bytes — that is exactly what the device
// recomputes and compares (iOS `base64UrlEncodedSHA256WithData`, Android
// `verifySHA256AndWriteToFile`), rejecting the asset on any mismatch. It must
// NEVER fall back to the namespaced dedup `hash` (sha256Namespaced of
// contentType + checksum), which is a DIFFERENT pre-image and would always fail
// the device's integrity check. `contentChecksum` is a NOT-NULL column populated
// on every publish/upload path, so it is always a real raw checksum here; the
// namespaced `hash` is used ONLY for R2 URL routing (assetUrl below).
const toAssetEntry = (baseUrl: string, asset: ManifestAssetData) => ({
  hash: asset.contentChecksum,
  key: asset.key,
  contentType: asset.contentType,
  fileExtension: `.${asset.fileExt}`,
  url: assetUrl(baseUrl, asset.hash),
});

const toLaunchEntry = (url: string, asset: ManifestAssetData) => ({
  hash: asset.contentChecksum,
  key: asset.key,
  contentType: asset.contentType,
  url,
});

/**
 * Render a manifest object from update + asset data.
 *
 * The field order — `id, createdAt, runtimeVersion, launchAsset, assets,
 * metadata, extra` — is LOAD-BEARING: `JSON.stringify` preserves insertion
 * order, so the CLI signs the byte string this produces and the server serves
 * the byte-identical string. Any reordering here breaks signature byte-identity.
 *
 * When `serverBaseUrl` + `projectId` are provided, the launch asset URL points
 * at the Worker bundle route (`launchBundleUrl`) so the Worker — not the CDN —
 * negotiates bsdiff patches. It falls back to the CDN asset URL when absent.
 */
export const buildManifest = (params: {
  readonly update: ManifestUpdateData;
  readonly assets: readonly ManifestAssetData[];
  readonly assetBaseUrl: string;
  readonly serverBaseUrl?: string;
  readonly projectId?: string;
}): object => {
  const { update, assets, assetBaseUrl, serverBaseUrl, projectId } = params;
  const launch = assets.find((asset) => asset.isLaunch);
  const regular = assets.filter((asset) => !asset.isLaunch);

  const launchUrl = (asset: ManifestAssetData) =>
    serverBaseUrl && projectId
      ? launchBundleUrl({ serverBaseUrl, projectId, updateId: update.id, hash: asset.hash })
      : assetUrl(assetBaseUrl, asset.hash);

  return {
    id: update.id,
    createdAt: update.createdAt,
    runtimeVersion: update.runtimeVersion,
    launchAsset: launch ? toLaunchEntry(launchUrl(launch), launch) : undefined,
    assets: regular.map((asset) => toAssetEntry(assetBaseUrl, asset)),
    metadata: update.metadata,
    extra: update.extra ?? {},
  };
};

/**
 * The `extensions` part of a manifest response. Shared by both ends so the
 * served shape stays consistent.
 */
export const buildExtensions = (): object => ({
  assetRequestHeaders: {},
});

// scopeKey derivation is shared by the server (manifest cache + per-tenant state)
// and the CLI (it injects extra.scopeKey into the rendered manifest). Re-exported
// here so both ends derive the device-identical origin from one pure source.
export { deriveScopeKey, normalizedURLOrigin } from "./scope-key";
export type { DeriveScopeKeyInput } from "./scope-key";
