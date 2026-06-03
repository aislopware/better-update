import path from "node:path";

import { launchBundleUrl } from "@better-update/expo-protocol";
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

import { formatCause } from "../lib/format-error";
import { printHuman } from "../lib/output";
import { selectBaseWindow } from "../lib/patch-base-window";
import { sha256File } from "../lib/sha256";
import { apiClient } from "../services/api-client";
import { BsdiffService } from "../services/bsdiff";
import { ConfigStore } from "../services/config-store";
import { PatchUploader } from "../services/patch-uploader";
import { PresignedDownloadClient } from "../services/presigned-download";

import type { Platform } from "../lib/build-profile";
import type { AuthRequiredError } from "../lib/exit-codes";
import type { OutputMode } from "../lib/output-mode";
import type { ApiClientService } from "../services/api-client";

export interface RunPatchPhaseInput {
  readonly projectId: string;
  readonly branch: string;
  readonly runtimeVersion: string;
  readonly platform: Platform;
  /** The update just created — the patch target (bspatch newfile). */
  readonly newUpdateId: string;
  /** Path to the new launch bundle on disk. */
  readonly newLaunchPath: string;
  /** Working directory for downloaded base bytes + produced patches. */
  readonly workDir: string;
  /** Max recent (non-embedded) bases to diff against. */
  readonly baseWindow: number;
  /** Concurrency for the per-base download+diff+upload pipeline. */
  readonly concurrency: number;
}

export interface PatchPhaseResult {
  readonly attempted: number;
  readonly uploaded: number;
  readonly skipped: number;
  /**
   * Size of the new launch bundle in bytes (the bspatch newfile). `undefined`
   * when the bundle could not be sized (best-effort — never fails the publish).
   * The denominator for savings%.
   */
  readonly newBundleBytes: number | undefined;
  /** Sum of every successfully-uploaded patch's byte size. */
  readonly totalPatchBytes: number;
  /**
   * Best (largest) savings ratio across uploaded patches, in [0, 1]. A patch
   * that is N% smaller than the full bundle has savingsPct = N/100. `undefined`
   * when nothing uploaded or the new bundle size is unknown — savings cannot be
   * computed without the denominator.
   */
  readonly bestSavingsPct: number | undefined;
}

// savingsPct = 1 - patchBytes/newBundleBytes, clamped to [0, 1]. A patch larger
// than the full bundle (negative savings) clamps to 0 — we never advertise a
// "negative saving". Returns undefined when the denominator is unknown/zero so
// callers omit savings rather than print a misleading 0%.
export const computeSavingsPct = (
  patchBytes: number,
  newBundleBytes: number | undefined,
): number | undefined => {
  if (newBundleBytes === undefined || newBundleBytes <= 0) {
    return undefined;
  }
  const ratio = 1 - patchBytes / newBundleBytes;
  return Math.max(0, ratio);
};

// Render a savings ratio in [0,1] as a whole-percent string (e.g. 0.94 → "94").
// Rounds to the nearest integer for the human line + table.
export const formatSavingsPct = (savingsPct: number): string =>
  String(Math.round(savingsPct * 100));

// Compute + upload one bsdiff patch per base, best-effort. A failure on any
// single base (download mismatch, bsdiff error, upload failure) is logged and
// swallowed so it never fails the publish — patches are an optimization, the
// full bundle is always served on a patch miss (resolve-bundle.ts).
//
// SLOT: called from publishPlatform AFTER api.updates.create returns the new id.
export const runPatchPhase = (
  input: RunPatchPhaseInput,
): Effect.Effect<
  PatchPhaseResult,
  AuthRequiredError,
  | ApiClientService
  | BsdiffService
  | PatchUploader
  | PresignedDownloadClient
  | ConfigStore
  | FileSystem.FileSystem
  | OutputMode
> =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    const configStore = yield* ConfigStore;
    const bsdiff = yield* BsdiffService;
    const downloader = yield* PresignedDownloadClient;
    const uploader = yield* PatchUploader;
    const fileSystem = yield* FileSystem.FileSystem;
    const serverBaseUrl = yield* configStore.getBaseUrl;

    yield* fileSystem.makeDirectory(input.workDir, { recursive: true }).pipe(Effect.ignore);

    const candidates = yield* api.updates
      .listPatchBases({
        urlParams: {
          projectId: input.projectId,
          // Resolve the base set by channel. `branch.create` auto-creates a
          // same-named channel (ensureBranchChannel), so the server resolves
          // this to the branch id. Passing both branchId+channel undefined would
          // make the server reject with BadRequest and yield zero candidates.
          channel: input.branch,
          runtimeVersion: input.runtimeVersion,
          platform: input.platform,
          // baseWindow=0 means "diff the embedded baseline only" (no recent
          // window). Never send limit=0: the server's clampPatchBaseLimit treats
          // `0 < 1` as invalid and silently falls back to its default (10). Send
          // 1 instead — the embedded baseline is force-included server-side
          // regardless of limit, and selectBaseWindow(maxRecent:0) below caps the
          // single recent row back out, leaving only the embedded baseline.
          limit: Math.max(1, input.baseWindow),
        },
      })
      .pipe(Effect.orElseSucceed(() => []));

    const bases = selectBaseWindow(candidates, {
      newUpdateId: input.newUpdateId,
      maxRecent: input.baseWindow,
    });

    if (bases.length === 0) {
      yield* printHuman("No patch bases available; skipping patch generation.");
      return {
        attempted: 0,
        uploaded: 0,
        skipped: 0,
        newBundleBytes: undefined,
        totalPatchBytes: 0,
        bestSavingsPct: undefined,
      } as const;
    }

    // Size the new launch bundle once — the denominator for savings%. Best-effort:
    // a sizing failure leaves newBundleBytes undefined so savings is simply
    // omitted (never fails the publish — patches are an optimization).
    const newBundleBytes = yield* sha256File(input.newLaunchPath).pipe(
      Effect.map((result) => result.byteSize),
      Effect.orElseSucceed((): number | undefined => undefined),
    );

    // Requirement 5: surface the base-window bound so a capped window is never a
    // silent truncation — show how many candidates the server returned vs how
    // many we will actually diff (selectBaseWindow may cap recent to baseWindow).
    yield* printHuman(
      `Diffing against ${bases.length} base(s) (window=${input.baseWindow}; ${candidates.length} candidate(s) available).`,
    );

    const outcomes = yield* Effect.forEach(
      bases,
      (base, index) =>
        Effect.gen(function* () {
          const basePath = path.join(input.workDir, `base-${index}.bundle`);
          const patchPath = path.join(input.workDir, `patch-${index}.bsdiff`);
          const baseUrl = launchBundleUrl({
            serverBaseUrl,
            projectId: input.projectId,
            updateId: base.updateId,
            hash: base.launchAssetHash,
          });

          yield* downloader.downloadToFile({
            url: baseUrl,
            outPath: basePath,
            expectedLaunchAssetHash: base.launchAssetHash,
          });

          yield* bsdiff.diff({
            baseFilePath: basePath,
            newFilePath: input.newLaunchPath,
            outPath: patchPath,
          });

          const { byteSize } = yield* sha256File(patchPath);

          const { key } = yield* uploader.uploadPatch({
            projectId: input.projectId,
            runtimeVersion: input.runtimeVersion,
            platform: input.platform,
            fromUpdateId: base.updateId,
            toUpdateId: input.newUpdateId,
            patchFilePath: patchPath,
            byteSize,
          });

          const savingsPct = computeSavingsPct(byteSize, newBundleBytes);
          const savingsSuffix =
            savingsPct === undefined ? "" : `, ${formatSavingsPct(savingsPct)}% smaller`;
          yield* printHuman(
            `  patch ${base.updateId} -> ${input.newUpdateId}${base.isEmbedded ? " (embedded baseline)" : ""}: uploaded ${key} (${byteSize} bytes${savingsSuffix})`,
          );
          return { kind: "uploaded", byteSize, savingsPct } as const;
        }).pipe(
          Effect.catchAll((cause) =>
            printHuman(`  skipped base ${base.updateId}: ${formatCause(cause)}`).pipe(
              Effect.as({ kind: "skipped" } as const),
            ),
          ),
        ),
      { concurrency: input.concurrency },
    );

    const uploadedOutcomes = outcomes.filter(
      (outcome): outcome is Extract<typeof outcome, { kind: "uploaded" }> =>
        outcome.kind === "uploaded",
    );
    const uploaded = uploadedOutcomes.length;
    const totalPatchBytes = uploadedOutcomes.reduce((sum, outcome) => sum + outcome.byteSize, 0);
    // Best (largest) savings across uploaded patches. undefined when nothing
    // uploaded or the new-bundle size was unknown (savingsPct never computed).
    const savingsValues = uploadedOutcomes
      .map((outcome) => outcome.savingsPct)
      .filter((value): value is number => value !== undefined);
    const bestSavingsPct = savingsValues.length === 0 ? undefined : Math.max(...savingsValues);

    return {
      attempted: bases.length,
      uploaded,
      skipped: bases.length - uploaded,
      newBundleBytes,
      totalPatchBytes,
      bestSavingsPct,
    } as const;
  });
