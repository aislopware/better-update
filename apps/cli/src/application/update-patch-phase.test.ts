import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { patchR2Key } from "@better-update/expo-protocol";
import { NodeContext } from "@effect/platform-node";
import { Data, Effect, Layer } from "effect";

import { makeOutputModeLayer } from "../lib/output-mode";
import { ApiClientService } from "../services/api-client";
import { BsdiffService } from "../services/bsdiff";
import { ConfigStore } from "../services/config-store";
import { PatchUploader } from "../services/patch-uploader";
import { PresignedDownloadClient } from "../services/presigned-download";
import { computeSavingsPct, formatSavingsPct, runPatchPhase } from "./update-patch-phase";

import type { ApiClient } from "../services/api-client";
import type { UploadPatchInput } from "../services/patch-uploader";
import type { DownloadToFileInput } from "../services/presigned-download";

const SERVER = "https://api.test.dev";

class ListPatchBasesError extends Data.TaggedError("ListPatchBasesError")<{
  message: string;
  cause?: unknown;
}> {}

const candidate = (overrides: { updateId: string; createdAt: string; isEmbedded?: boolean }) => ({
  updateId: overrides.updateId,
  launchAssetHash: `hash-${overrides.updateId}`,
  runtimeVersion: "1.0.0",
  platform: "ios" as const,
  isEmbedded: overrides.isEmbedded ?? false,
  createdAt: overrides.createdAt,
});

interface ListPatchBasesUrlParams {
  readonly projectId: string;
  readonly branchId?: string | undefined;
  readonly channel?: string | undefined;
  readonly runtimeVersion: string;
  readonly platform: string;
  readonly limit?: number | undefined;
}

const makeApiLayer = (
  bases: readonly ReturnType<typeof candidate>[],
  recorder?: { params: ListPatchBasesUrlParams[] },
) =>
  Layer.succeed(ApiClientService, {
    get: Effect.succeed({
      updates: {
        listPatchBases: (request: { urlParams: ListPatchBasesUrlParams }) => {
          recorder?.params.push(request.urlParams);
          // Mirror the server contract: resolvePatchBaseBranchId FAILS with
          // BadRequest when BOTH branchId and channel are undefined. If the CLI
          // ever regresses to sending neither, the phase must see an empty set
          // (the real listPatchBases surfaces that BadRequest, which the phase
          // swallows to []), NOT the happy-path bases.
          const { branchId, channel } = request.urlParams;
          if (branchId === undefined && channel === undefined) {
            return Effect.fail(
              new ListPatchBasesError({ message: "Either branchId or channel is required" }),
            );
          }
          return Effect.succeed(bases);
        },
      },
    } as unknown as ApiClient),
    exchangeOneTimeToken: () => Effect.succeed("token"),
  });

const configLayer = Layer.succeed(ConfigStore, {
  getBaseUrl: Effect.succeed(SERVER),
  getWebUrl: Effect.succeed(SERVER),
  getAssetCdnUrl: Effect.succeed(SERVER),
});

interface Recorder {
  readonly downloads: DownloadToFileInput[];
  readonly diffs: { baseFilePath: string; newFilePath: string; outPath: string }[];
  readonly uploads: UploadPatchInput[];
  readonly listParams: ListPatchBasesUrlParams[];
}

const makeFakes = (recorder: Recorder, opts?: { failBase?: string }) => {
  const downloader = Layer.succeed(PresignedDownloadClient, {
    downloadToFile: (input: DownloadToFileInput) =>
      Effect.gen(function* () {
        recorder.downloads.push(input);
        yield* Effect.promise(async () =>
          writeFile(input.outPath, Buffer.from(`base:${input.url}`)),
        );
        return { byteSize: 10 };
      }),
  });

  const bsdiff = Layer.succeed(BsdiffService, {
    diff: (input) =>
      Effect.gen(function* () {
        recorder.diffs.push(input);
        // Write a stub BSDIFF40-magic file so sha256File can size it.
        yield* Effect.promise(async () =>
          writeFile(input.outPath, Buffer.concat([Buffer.from("BSDIFF40"), Buffer.alloc(32)])),
        );
      }),
  });

  const uploader = Layer.succeed(PatchUploader, {
    uploadPatch: (input: UploadPatchInput) =>
      Effect.gen(function* () {
        if (opts?.failBase === input.fromUpdateId) {
          return yield* new (yield* Effect.promise(
            async () => import("../lib/exit-codes"),
          )).PatchUploadError({
            message: "boom",
          });
        }
        recorder.uploads.push(input);
        return {
          key: patchR2Key({
            projectId: input.projectId,
            runtimeVersion: input.runtimeVersion,
            platform: input.platform,
            fromUpdateId: input.fromUpdateId,
            toUpdateId: input.toUpdateId,
          }),
        };
      }),
  });

  return Layer.mergeAll(downloader, bsdiff, uploader);
};

const run = async (
  recorder: Recorder,
  bases: readonly ReturnType<typeof candidate>[],
  input: Parameters<typeof runPatchPhase>[0],
  opts?: { failBase?: string },
) =>
  runPatchPhase(input).pipe(
    Effect.provide(
      Layer.mergeAll(
        makeApiLayer(bases, { params: recorder.listParams }),
        configLayer,
        makeFakes(recorder, opts),
        makeOutputModeLayer(false),
        NodeContext.layer,
      ),
    ),
    Effect.runPromise,
  );

const baseInput = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "patch-phase-"));
  const newLaunch = path.join(dir, "new.bundle");
  await writeFile(newLaunch, Buffer.from("new bundle bytes"));
  return {
    projectId: "proj_1",
    branch: "main",
    runtimeVersion: "1.0.0",
    platform: "ios" as const,
    newUpdateId: "new-update",
    newLaunchPath: newLaunch,
    workDir: path.join(dir, "work"),
    baseWindow: 10,
    concurrency: 2,
  };
};

describe(runPatchPhase, () => {
  it("downloads, diffs and uploads one patch per selected base", async () => {
    const recorder: Recorder = { downloads: [], diffs: [], uploads: [], listParams: [] };
    const bases = [
      candidate({ updateId: "b1", createdAt: "2026-01-03T00:00:00.000Z" }),
      candidate({ updateId: "b2", createdAt: "2026-01-02T00:00:00.000Z" }),
    ];
    const result = await run(recorder, bases, await baseInput());

    expect(result.attempted).toBe(2);
    expect(result.uploaded).toBe(2);
    expect(recorder.downloads).toHaveLength(2);
    expect(recorder.diffs).toHaveLength(2);
    expect(recorder.uploads.map((entry) => entry.fromUpdateId).toSorted()).toStrictEqual([
      "b1",
      "b2",
    ]);
    expect(recorder.uploads.every((entry) => entry.toUpdateId === "new-update")).toBe(true);
  });

  it("verifies the base via the expected launch-asset hash and Worker bundle URL", async () => {
    const recorder: Recorder = { downloads: [], diffs: [], uploads: [], listParams: [] };
    const bases = [candidate({ updateId: "b1", createdAt: "2026-01-03T00:00:00.000Z" })];
    await run(recorder, bases, await baseInput());

    const [download] = recorder.downloads;
    expect(download?.expectedLaunchAssetHash).toBe("hash-b1");
    expect(download?.url).toBe(`${SERVER}/manifest/proj_1/bundle/b1/hash-b1`);
  });

  it("a failed base is swallowed (best-effort) and does not fail the publish", async () => {
    const recorder: Recorder = { downloads: [], diffs: [], uploads: [], listParams: [] };
    const bases = [
      candidate({ updateId: "b1", createdAt: "2026-01-03T00:00:00.000Z" }),
      candidate({ updateId: "b2", createdAt: "2026-01-02T00:00:00.000Z" }),
    ];
    const result = await run(recorder, bases, await baseInput(), { failBase: "b1" });

    expect(result.attempted).toBe(2);
    expect(result.uploaded).toBe(1);
    expect(result.skipped).toBe(1);
    expect(recorder.uploads.map((entry) => entry.fromUpdateId)).toStrictEqual(["b2"]);
  });

  it("returns zero work when there are no bases", async () => {
    const recorder: Recorder = { downloads: [], diffs: [], uploads: [], listParams: [] };
    const result = await run(recorder, [], await baseInput());
    expect(result).toStrictEqual({
      attempted: 0,
      uploaded: 0,
      skipped: 0,
      newBundleBytes: undefined,
      totalPatchBytes: 0,
      bestSavingsPct: undefined,
    });
  });

  it("resolves the base set by channel=branch so the server contract accepts the request", async () => {
    // Regression for the P0: sending branchId+channel BOTH undefined makes the
    // real server reject with BadRequest and the phase produce ZERO patches.
    const recorder: Recorder = { downloads: [], diffs: [], uploads: [], listParams: [] };
    const bases = [candidate({ updateId: "b1", createdAt: "2026-01-03T00:00:00.000Z" })];
    const result = await run(recorder, bases, await baseInput());

    const [params] = recorder.listParams;
    expect(params).toBeDefined();
    // A branch or channel MUST be present (mutually-exclusive resolution inputs);
    // the CLE forwards the branch name as the channel.
    expect(params?.branchId ?? params?.channel).toBeDefined();
    expect(params?.channel).toBe("main");
    expect(params?.runtimeVersion).toBe("1.0.0");
    expect(params?.platform).toBe("ios");
    // The contract is satisfied, so the happy-path base is actually diffed.
    expect(result.attempted).toBe(1);
    expect(result.uploaded).toBe(1);
  });

  it("never sends limit=0 (server reinterprets it as the default 10)", async () => {
    // P3: baseWindow=0 means embedded-baseline-only; the CLI must send limit>=1
    // because clampPatchBaseLimit treats limit<1 as invalid and falls back to 10.
    const recorder: Recorder = { downloads: [], diffs: [], uploads: [], listParams: [] };
    const input = { ...(await baseInput()), baseWindow: 0 };
    await run(recorder, [], input);

    const [params] = recorder.listParams;
    expect(params?.limit).toBe(1);
  });

  it("sizes the new bundle and surfaces totalPatchBytes + best savings%", async () => {
    // The bsdiff stub writes a 40-byte patch (8-byte magic + 32 padding). Make
    // the new launch bundle 1000 bytes so the patch yields a real, large saving:
    // 1 - 40/1000 = 0.96 → 96%.
    const dir = await mkdtemp(path.join(tmpdir(), "patch-phase-savings-"));
    const newLaunch = path.join(dir, "new.bundle");
    await writeFile(newLaunch, Buffer.alloc(1000, 1));
    const input = {
      projectId: "proj_1",
      branch: "main",
      runtimeVersion: "1.0.0",
      platform: "ios" as const,
      newUpdateId: "new-update",
      newLaunchPath: newLaunch,
      workDir: path.join(dir, "work"),
      baseWindow: 10,
      concurrency: 2,
    };
    const recorder: Recorder = { downloads: [], diffs: [], uploads: [], listParams: [] };
    const bases = [
      candidate({ updateId: "b1", createdAt: "2026-01-03T00:00:00.000Z" }),
      candidate({ updateId: "b2", createdAt: "2026-01-02T00:00:00.000Z" }),
    ];
    const result = await run(recorder, bases, input);

    expect(result.newBundleBytes).toBe(1000);
    // Two uploaded patches, 40 bytes each.
    expect(result.totalPatchBytes).toBe(80);
    expect(result.bestSavingsPct).toBeCloseTo(0.96, 5);
  });
});

describe(computeSavingsPct, () => {
  it("computes 1 - patchBytes/newBundleBytes", () => {
    // A 480KB patch off an 8MB bundle ≈ the audit's ~94% headline.
    expect(computeSavingsPct(480_000, 8_000_000)).toBeCloseTo(0.94, 5);
    expect(computeSavingsPct(50, 200)).toBeCloseTo(0.75, 5);
  });

  it("clamps a patch larger than the full bundle to 0 (never negative savings)", () => {
    expect(computeSavingsPct(300, 200)).toBe(0);
  });

  it("returns undefined when the new-bundle size is unknown or zero", () => {
    expect(computeSavingsPct(100, undefined)).toBeUndefined();
    expect(computeSavingsPct(100, 0)).toBeUndefined();
  });
});

describe(formatSavingsPct, () => {
  it("renders a [0,1] ratio as a rounded whole-percent string", () => {
    expect(formatSavingsPct(0.94)).toBe("94");
    expect(formatSavingsPct(0.945)).toBe("95");
    expect(formatSavingsPct(0)).toBe("0");
    expect(formatSavingsPct(1)).toBe("100");
  });
});
