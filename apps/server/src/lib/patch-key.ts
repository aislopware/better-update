import type { Platform } from "../models";

/**
 * The parsed identity of a precomputed bsdiff patch object, recovered from its
 * R2 key. Inverse of `patchR2Key` from `@better-update/expo-protocol`.
 */
export interface ParsedPatchKey {
  readonly projectId: string;
  readonly runtimeVersion: string;
  readonly platform: Platform;
  /** Base update id the patch diffs from. Lowercased on disk. */
  readonly fromUpdateId: string;
  /** Target update id the patch produces. Lowercased on disk. */
  readonly toUpdateId: string;
}

const PATCHES_PREFIX = "patches/";
const SUFFIX = ".bsdiff";
const FROM_TO_SEPARATOR = "__";

const isSafeSegment = (segment: string): boolean =>
  segment.length > 0 &&
  !segment.includes("/") &&
  !segment.includes("\\") &&
  !segment.includes("..") &&
  !segment.includes("\0");

const isPlatform = (value: string): value is Platform => value === "ios" || value === "android";

/**
 * Pure inverse of `patchR2Key`: parse a
 * `patches/{projectId}/{rv}/{platform}/{from}__{to}.bsdiff` key back into its
 * tuple. Returns `null` for any malformed shape (wrong segment count, missing
 * `__` separator, bad platform, path traversal, empty segment, missing
 * `.bsdiff` suffix) so the OTA reaper can treat unparseable keys as orphan junk.
 *
 * PURE: no I/O, no Effect. Lives in `lib/` (a pure leaf) because it pairs with
 * the shared `patchR2Key` builder and keeps R2-key-string concerns out of the
 * imperative shell and out of `domain/`.
 */
export const parsePatchKey = (key: string): ParsedPatchKey | null => {
  if (!key.startsWith(PATCHES_PREFIX) || !key.endsWith(SUFFIX)) {
    return null;
  }

  const body = key.slice(PATCHES_PREFIX.length, key.length - SUFFIX.length);
  const segments = body.split("/");
  // Exactly: projectId / runtimeVersion / platform / {from}__{to}
  if (segments.length !== 4) {
    return null;
  }

  const [projectId, runtimeVersion, platform, fromTo] = segments;
  if (
    projectId === undefined ||
    runtimeVersion === undefined ||
    platform === undefined ||
    fromTo === undefined
  ) {
    return null;
  }

  if (!isPlatform(platform)) {
    return null;
  }

  const separatorIndex = fromTo.indexOf(FROM_TO_SEPARATOR);
  if (separatorIndex === -1) {
    return null;
  }

  const fromUpdateId = fromTo.slice(0, separatorIndex);
  const toUpdateId = fromTo.slice(separatorIndex + FROM_TO_SEPARATOR.length);
  // A second `__` would make the from/to split ambiguous; reject it.
  if (toUpdateId.includes(FROM_TO_SEPARATOR)) {
    return null;
  }

  if (![projectId, runtimeVersion, fromUpdateId, toUpdateId].every(isSafeSegment)) {
    return null;
  }

  return { projectId, runtimeVersion, platform, fromUpdateId, toUpdateId };
};
