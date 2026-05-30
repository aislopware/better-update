// Pure bsdiff content-negotiation logic for the Expo OTA bundle route.
//
// bsdiff patches follow RFC 3229 ("Delta encoding in HTTP", Instance Manipulation)
// semantics on the ASSET/BUNDLE download request (NOT the manifest request):
//   - request advertises support via `a-im: bsdiff`
//   - request carries candidate base ids (`expo-current-update-id`,
//     `expo-embedded-update-id`) and the patch target (`expo-requested-update-id`)
//   - response declares a patch body via `im: bsdiff` + `expo-base-update-id`
//
// Verified against expo/expo @ sdk-56 FileDownloader.kt + CHANGELOG (56.0.0 patch
// content negotiation, 56.0.6 runtime-version on asset requests, 56.0.14 bsdiff
// enabled by default) and docs.expo.dev/eas-update/bundle-diffing.
//
// This module is PURE: no I/O, no Effect. Header lookups are case-insensitive
// (HTTP header names are case-insensitive and the Headers API lowercases them),
// and update ids are lowercased to match the lowercased uuids the client sends.

import { toOptional } from "../lib/nullable";

// patchR2Key + isValidPatchKey are PURE and shared with the CLI (which builds
// the same key to upload patches + detect skips). They live in
// @better-update/expo-protocol so server + CLI agree byte-for-byte on the patch
// key shape; re-exported here so existing server imports stay stable.
export { isValidPatchKey, patchR2Key } from "@better-update/expo-protocol";

type Platform = "ios" | "android";

export interface PatchRequest {
  /** Client advertised bsdiff support via `a-im: bsdiff`. */
  readonly supportsBsdiff: boolean;
  /** Currently-launched update on device (candidate patch base). */
  readonly currentUpdateId: string | undefined;
  /** Update embedded in the binary at build time (candidate patch base). */
  readonly embeddedUpdateId: string | undefined;
  /** Update being fetched (the patch target). */
  readonly requestedUpdateId: string | undefined;
  /** Runtime version (sent on asset requests since expo-updates 56.0.6). */
  readonly runtimeVersion: string | undefined;
  /** Platform forwarded on asset requests. */
  readonly platform: Platform | undefined;
}

const lowerOrUndefined = (value: string | null): string | undefined => {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.toLowerCase() : undefined;
};

const parsePlatform = (value: string | null): Platform | undefined => {
  const lowered = lowerOrUndefined(value);
  return lowered === "ios" || lowered === "android" ? lowered : undefined;
};

const supportsBsdiff = (aim: string | null): boolean => {
  if (!aim) {
    return false;
  }
  return aim
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .includes("bsdiff");
};

/**
 * Parse the RFC-3229 / Expo patch-negotiation headers off a bundle/asset request.
 * Absent `a-im` => client does NOT support patches => caller MUST serve full bundle.
 */
export const parsePatchRequest = (headers: Headers): PatchRequest => ({
  supportsBsdiff: supportsBsdiff(headers.get("a-im")),
  currentUpdateId: lowerOrUndefined(headers.get("expo-current-update-id")),
  embeddedUpdateId: lowerOrUndefined(headers.get("expo-embedded-update-id")),
  requestedUpdateId: lowerOrUndefined(headers.get("expo-requested-update-id")),
  runtimeVersion: toOptional(headers.get("expo-runtime-version")),
  platform: parsePlatform(headers.get("expo-platform")),
});

/**
 * Ordered patch-base candidates for a target update id: [currentUpdateId,
 * embeddedUpdateId], lowercased, with undefined entries and any candidate equal
 * to the target dropped (a self-patch is meaningless). The caller probes R2 with
 * each candidate in order; first hit wins.
 */
export const selectPatchCandidates = (
  request: PatchRequest,
  toUpdateId: string,
): readonly string[] => {
  const target = toUpdateId.toLowerCase();
  const lowered = [request.currentUpdateId, request.embeddedUpdateId]
    .flatMap((candidate) => (candidate ? [candidate.toLowerCase()] : []))
    .filter((candidate) => candidate !== target);
  // Dedup while preserving [current, embedded] order.
  return [...new Set(lowered)];
};

/**
 * Response headers declaring a bsdiff patch body (RFC 3229 IM header +
 * the base update the patch was computed against).
 */
export const patchResponseHeaders = (baseUpdateId: string): Readonly<Record<string, string>> => ({
  im: "bsdiff",
  "expo-base-update-id": baseUpdateId.toLowerCase(),
});

/**
 * Validate an asset/bundle request's runtime version against the requested
 * update's runtime version (expo-updates 56.0.6 sends `expo-runtime-version` on
 * asset requests). Absent header => valid (backward compat with pre-56.0.6
 * clients); present + mismatch => invalid (prevents cross-runtime confusion).
 */
export const validateAssetRuntime = (params: {
  readonly headerRuntimeVersion: string | undefined;
  readonly updateRuntimeVersion: string;
}): boolean => {
  if (params.headerRuntimeVersion === undefined) {
    return true;
  }
  return params.headerRuntimeVersion === params.updateRuntimeVersion;
};
