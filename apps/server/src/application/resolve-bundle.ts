import { Effect } from "effect";

import {
  patchR2Key,
  selectPatchCandidates,
  validateAssetRuntime,
} from "../protocol/patch-negotiation";
import { BundleRepo, ManifestRepo } from "../repositories";

import type { PatchRequest } from "../protocol/patch-negotiation";
import type { StoredBlob } from "../repositories/bundle";

// Multi-repo orchestration for the Expo OTA bundle route (A-IM negotiation).
//
// Decides patch-vs-full for a requested update id, composing the pure protocol/
// selection logic (candidate base ids, deterministic patch R2 key, runtime
// validation) with the ManifestRepo (resolve the launch asset + its runtime
// version) and BundleRepo (R2 reads). No HTTP, no cloudflare/ — the handler
// turns the returned decision into a Response.

/** The requested update id is unknown, or its runtime version does not match. */
export interface BundleResolutionNotFound {
  readonly kind: "not-found";
}

/** Serve a precomputed bsdiff patch computed against `baseUpdateId`. */
export interface BundleResolutionPatch {
  readonly kind: "patch";
  readonly baseUpdateId: string;
  readonly blob: StoredBlob;
}

/** Serve the full launch bundle (backward-compatible fallback). */
export interface BundleResolutionFull {
  readonly kind: "full";
  readonly blob: StoredBlob;
}

export type BundleResolution =
  | BundleResolutionNotFound
  | BundleResolutionPatch
  | BundleResolutionFull;

const notFound: BundleResolution = { kind: "not-found" };

/**
 * Probe each candidate base id in order ([current, embedded]) and return the
 * first precomputed patch present in R2, or null when none match.
 */
const resolvePatch = (params: {
  readonly request: PatchRequest;
  readonly projectId: string;
  readonly runtimeVersion: string;
  readonly platform: string;
  readonly updateId: string;
}) =>
  Effect.gen(function* () {
    const bundleRepo = yield* BundleRepo;
    const candidates = selectPatchCandidates(params.request, params.updateId);

    // Probe candidates in order; first hit wins, short-circuiting the rest.
    return yield* Effect.reduce(
      candidates,
      null as { readonly baseUpdateId: string; readonly blob: StoredBlob } | null,
      (found, baseUpdateId) =>
        found === null
          ? bundleRepo
              .getPatch({
                key: patchR2Key({
                  projectId: params.projectId,
                  runtimeVersion: params.runtimeVersion,
                  platform: params.platform,
                  fromUpdateId: baseUpdateId,
                  toUpdateId: params.updateId,
                }),
              })
              .pipe(Effect.map((blob) => (blob === null ? null : { baseUpdateId, blob })))
          : Effect.succeed(found),
    );
  });

/**
 * Resolve what to serve for a bundle request: a bsdiff patch when the client
 * supports it and a matching precomputed patch exists, otherwise the full
 * launch bundle. Returns not-found when the update id is unknown or the
 * request's runtime version does not match the update's runtime version.
 */
export const resolveBundle = (params: {
  readonly request: PatchRequest;
  readonly projectId: string;
  readonly updateId: string;
}) =>
  Effect.gen(function* () {
    const manifestRepo = yield* ManifestRepo;
    const bundleRepo = yield* BundleRepo;

    const launchAsset = yield* manifestRepo.findLaunchAssetForUpdate({
      updateId: params.updateId,
    });
    if (launchAsset === null) {
      return notFound;
    }

    if (
      !validateAssetRuntime({
        headerRuntimeVersion: params.request.runtimeVersion,
        updateRuntimeVersion: launchAsset.runtime_version,
      })
    ) {
      return notFound;
    }

    if (params.request.supportsBsdiff && params.request.platform !== undefined) {
      const patch = yield* resolvePatch({
        request: params.request,
        projectId: params.projectId,
        runtimeVersion: launchAsset.runtime_version,
        platform: params.request.platform,
        updateId: params.updateId,
      });
      if (patch !== null) {
        return {
          kind: "patch",
          baseUpdateId: patch.baseUpdateId,
          blob: patch.blob,
        } satisfies BundleResolutionPatch;
      }
    }

    const blob = yield* bundleRepo.getFullBundle({ hash: launchAsset.hash });
    if (blob === null) {
      return notFound;
    }
    return { kind: "full", blob } satisfies BundleResolutionFull;
  });
