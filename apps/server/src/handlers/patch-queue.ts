import { Effect } from "effect";

import { AssetStorage } from "../cloudflare/asset-storage";
import { provideCloudflareEnv } from "../cloudflare/context";
import { ServerInfrastructureLayer } from "../infrastructure-layer";
import { AssetRepo, PatchRepo } from "../repositories";

import type { ServerInfrastructure } from "../infrastructure-layer";

interface PatchJobMessage {
  readonly oldHash: string;
  readonly newHash: string;
}

const BYTES_PER_MB = 1_048_576;

const parseMaxSize = (raw: string | undefined) => Number.parseInt(raw ?? "4194304", 10);

const parseMinSaving = (raw: string | undefined) => Number.parseFloat(raw ?? "0.8");

const exceedsSize = (oldSize: number, newSize: number, maxSize: number) =>
  Math.max(oldSize, newSize) > maxSize;

const patchNotWorth = (patchSize: number, newSize: number, minSaving: number) =>
  patchSize >= minSaving * newSize;

const runPatchEffect = async <Success, Error>(
  effect: Effect.Effect<Success, Error, ServerInfrastructure>,
  env: Env,
) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(ServerInfrastructureLayer), (program) =>
      provideCloudflareEnv(program, env),
    ),
  );

const alreadyExists = (message: PatchJobMessage) =>
  Effect.gen(function* () {
    const repo = yield* PatchRepo;
    return (
      (yield* repo.findByHashes({ oldHash: message.oldHash, newHash: message.newHash })) !== null
    );
  });

const fetchBundles = (message: PatchJobMessage) =>
  Effect.gen(function* () {
    const assetRepo = yield* AssetRepo;
    const storage = yield* AssetStorage;

    const [oldAsset, newAsset] = yield* Effect.all(
      [
        assetRepo.findByHash({ hash: message.oldHash }),
        assetRepo.findByHash({ hash: message.newHash }),
      ],
      { concurrency: "unbounded" },
    );

    const [oldObject, newObject] = yield* Effect.all(
      [
        oldAsset ? storage.getObject({ key: oldAsset.r2Key }) : Effect.succeed(null),
        newAsset ? storage.getObject({ key: newAsset.r2Key }) : Effect.succeed(null),
      ],
      { concurrency: "unbounded" },
    );

    return { oldObject, newObject };
  });

const readBundleBytes = (
  oldObject: { readonly body: ReadableStream | null },
  newObject: { readonly body: ReadableStream | null },
) =>
  Effect.all(
    [
      Effect.promise(async () => new Uint8Array(await new Response(oldObject.body).arrayBuffer())),
      Effect.promise(async () => new Uint8Array(await new Response(newObject.body).arrayBuffer())),
    ],
    { concurrency: "unbounded" },
  );

const storePatch = (message: PatchJobMessage, patchBytes: Uint8Array, r2Key: string) =>
  Effect.gen(function* () {
    const storage = yield* AssetStorage;
    const repo = yield* PatchRepo;

    yield* storage.putObject({
      key: r2Key,
      body: patchBytes,
      contentType: "application/octet-stream",
    });
    yield* repo.insert({
      oldHash: message.oldHash,
      newHash: message.newHash,
      byteSize: patchBytes.length,
      r2Key,
    });
  });

export const handlePatchMessage = async (message: PatchJobMessage, env: Env): Promise<void> => {
  if (await runPatchEffect(alreadyExists(message), env)) {
    return;
  }

  const { oldObject, newObject } = await runPatchEffect(fetchBundles(message), env);
  if (!oldObject || !newObject) {
    console.warn("[patch-queue] Asset not found in R2, skipping", message);
    return;
  }

  const maxSize = parseMaxSize(env.PATCH_MAX_BUNDLE_SIZE);
  if (exceedsSize(oldObject.size, newObject.size, maxSize)) {
    console.info("[patch-queue] Bundle exceeds size limit, skipping", {
      oldSize: `${(oldObject.size / BYTES_PER_MB).toFixed(1)}MB`,
      newSize: `${(newObject.size / BYTES_PER_MB).toFixed(1)}MB`,
      maxSize: `${(maxSize / BYTES_PER_MB).toFixed(1)}MB`,
    });
    return;
  }

  const [oldBytes, newBytes] = await Effect.runPromise(readBundleBytes(oldObject, newObject));

  const { diff } = await import("@better-update/bsdiff-wasm");
  const patchBytes = diff(oldBytes, newBytes);

  const minSaving = parseMinSaving(env.PATCH_MIN_SAVING);
  if (patchNotWorth(patchBytes.length, newBytes.length, minSaving)) {
    console.info("[patch-queue] Patch not worth serving", {
      patchSize: patchBytes.length,
      newSize: newBytes.length,
      ratio: (patchBytes.length / newBytes.length).toFixed(2),
    });
    return;
  }

  const r2Key = `patches/${message.oldHash}/${message.newHash}.patch`;
  await runPatchEffect(storePatch(message, patchBytes, r2Key), env);

  console.info("[patch-queue] Patch generated", {
    oldHash: message.oldHash,
    newHash: message.newHash,
    patchSize: patchBytes.length,
    ratio: (patchBytes.length / newBytes.length).toFixed(2),
  });
};
