interface PatchJobMessage {
  readonly oldHash: string;
  readonly newHash: string;
}

// -- Size + ratio guards (extracted to stay within max-statements) -----------

const BYTES_PER_MB = 1_048_576;

const parseMaxSize = (raw: string | undefined) => Number.parseInt(raw ?? "4194304", 10);

const parseMinSaving = (raw: string | undefined) => Number.parseFloat(raw ?? "0.8");

const exceedsSize = (oldSize: number, newSize: number, maxSize: number) =>
  Math.max(oldSize, newSize) > maxSize;

const patchNotWorth = (patchSize: number, newSize: number, minSaving: number) =>
  patchSize >= minSaving * newSize;

// -- Idempotency check -------------------------------------------------------

const alreadyExists = async (env: Env, message: PatchJobMessage) => {
  const row = await env.DB.prepare(
    `SELECT 1 FROM "patches" WHERE "old_asset_hash" = ? AND "new_asset_hash" = ?`,
  )
    .bind(message.oldHash, message.newHash)
    .first();
  return row !== null;
};

// -- R2 fetch ----------------------------------------------------------------

const fetchBundles = async (env: Env, message: PatchJobMessage) => {
  const [oldObject, newObject] = await Promise.all([
    env.ASSETS_BUCKET.get(`assets/${message.oldHash}`),
    env.ASSETS_BUCKET.get(`assets/${message.newHash}`),
  ]);
  return { oldObject, newObject };
};

// -- Store result ------------------------------------------------------------

const storePatch = async (
  env: Env,
  message: PatchJobMessage,
  patchBytes: Uint8Array,
  r2Key: string,
) => {
  await env.ASSETS_BUCKET.put(r2Key, patchBytes, {
    httpMetadata: { contentType: "application/octet-stream" },
  });
  await env.DB.prepare(
    `INSERT INTO "patches" ("old_asset_hash", "new_asset_hash", "byte_size", "r2_key", "created_at") VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(message.oldHash, message.newHash, patchBytes.length, r2Key, new Date().toISOString())
    .run();
};

// -- Main handler ------------------------------------------------------------

export const handlePatchMessage = async (message: PatchJobMessage, env: Env): Promise<void> => {
  if (await alreadyExists(env, message)) {
    return;
  }

  const { oldObject, newObject } = await fetchBundles(env, message);
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

  const [oldBytes, newBytes] = await Promise.all([
    oldObject.arrayBuffer().then((buf) => new Uint8Array(buf)),
    newObject.arrayBuffer().then((buf) => new Uint8Array(buf)),
  ]);

  // WASM init may be needed for Workers — see @better-update/bsdiff-wasm setup
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
  await storePatch(env, message, patchBytes, r2Key);

  console.info("[patch-queue] Patch generated", {
    oldHash: message.oldHash,
    newHash: message.newHash,
    patchSize: patchBytes.length,
    ratio: (patchBytes.length / newBytes.length).toFixed(2),
  });
};
