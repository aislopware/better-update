import { bumpChannelCacheVersionByBranchReference } from "../repositories/channel-cache-version";
import { SerializedCoordinator } from "./serialized-coordinator";

import type {
  CreateUpdateRequest,
  EnsureBranchChannelResult,
  RepublishUpdateRequest,
  SerializedAssetRef,
  SerializedUpdate,
} from "./publish-types";

interface BranchRow {
  readonly id: string;
}

interface ChannelRow {
  readonly id: string;
  readonly branchId: string;
}

interface LatestRolloutRow {
  readonly rolloutPercentage: number;
}

interface LaunchAssetRow {
  readonly assetHash: string;
}

interface InsertResolution {
  readonly id: string;
  readonly created: boolean;
}

interface PublishRecord {
  readonly id: string;
  readonly branchId: string;
  readonly runtimeVersion: string;
  readonly platform: "ios" | "android";
  readonly message: string;
  readonly metadataJson: string;
  readonly extraJson: string | null;
  readonly groupId: string;
  readonly rolloutPercentage: number;
  readonly isRollback: boolean;
  readonly signature: string | null;
  readonly certificateChain: string | null;
  readonly manifestBody: string | null;
  readonly directiveBody: string | null;
  readonly assets: readonly SerializedAssetRef[];
  readonly createdAt: string;
}

interface PublishOperation extends CreateUpdateRequest {
  readonly conflictMessage: string;
}

interface CoordinatorFailure {
  readonly ok: false;
  readonly message: string;
}

interface CoordinatorSuccess<Value> {
  readonly ok: true;
  readonly value: Value;
}

type CoordinatorResult<Value> = CoordinatorFailure | CoordinatorSuccess<Value>;

const CREATE_ROLLOUT_CONFLICT_MESSAGE =
  "Cannot publish while a per-update rollout is active. Complete or revert the rollout first.";

const REPUBLISH_ROLLOUT_CONFLICT_MESSAGE =
  "Cannot republish while a per-update rollout is active on the target branch. Complete or revert the rollout first.";

const channelLinkedElsewhereMessage = (branchName: string) =>
  `Channel "${branchName}" already exists and points to a different branch`;

const channelAlreadyExistsMessage = (branchName: string) =>
  `Channel "${branchName}" already exists in this project`;

const isUniqueConstraintError = (error: unknown): boolean =>
  String(error).includes("UNIQUE constraint failed");

const nowIso = (): string => new Date().toISOString();

const conflict = <Value>(message: string): CoordinatorResult<Value> => ({ ok: false, message });
const success = <Value>(value: Value): CoordinatorResult<Value> => ({ ok: true, value });

const findBranchByProjectAndName = async (
  db: D1Database,
  projectId: string,
  name: string,
): Promise<BranchRow | null> =>
  db
    .prepare(`SELECT "id" FROM "branches" WHERE "project_id" = ? AND "name" = ?`)
    .bind(projectId, name)
    .first<BranchRow>();

const findChannelByProjectAndName = async (
  db: D1Database,
  projectId: string,
  name: string,
): Promise<ChannelRow | null> =>
  db
    .prepare(
      `SELECT "id", "branch_id" AS "branchId" FROM "channels" WHERE "project_id" = ? AND "name" = ?`,
    )
    .bind(projectId, name)
    .first<ChannelRow>();

const findChannelById = async (db: D1Database, channelId: string): Promise<ChannelRow | null> =>
  db
    .prepare(`SELECT "id", "branch_id" AS "branchId" FROM "channels" WHERE "id" = ?`)
    .bind(channelId)
    .first<ChannelRow>();

const insertBranch = async (
  db: D1Database,
  params: { readonly id: string; readonly projectId: string; readonly name: string },
): Promise<void> => {
  await db
    .prepare(
      `INSERT INTO "branches" ("id", "project_id", "name", "created_at") VALUES (?, ?, ?, ?)`,
    )
    .bind(params.id, params.projectId, params.name, nowIso())
    .run();
};

const insertChannel = async (
  db: D1Database,
  params: {
    readonly id: string;
    readonly projectId: string;
    readonly name: string;
    readonly branchId: string;
  },
): Promise<void> => {
  await db
    .prepare(
      `INSERT INTO "channels" ("id", "project_id", "name", "branch_id", "branch_mapping_json", "cache_version", "is_paused", "created_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(params.id, params.projectId, params.name, params.branchId, null, 0, 0, nowIso())
    .run();
};

const getExistingMismatch = (
  branch: BranchRow | null,
  channel: ChannelRow | null,
  branchName: string,
): string | null => {
  if (branch !== null && channel !== null && channel.branchId !== branch.id) {
    return channelLinkedElsewhereMessage(branchName);
  }

  if (branch === null && channel !== null) {
    return channelAlreadyExistsMessage(branchName);
  }

  return null;
};

const resolveBranch = async (
  db: D1Database,
  params: {
    readonly existingBranch: BranchRow | null;
    readonly projectId: string;
    readonly branchName: string;
  },
): Promise<InsertResolution> => {
  if (params.existingBranch !== null) {
    return { id: params.existingBranch.id, created: false };
  }

  const id = crypto.randomUUID();
  const insertResult = insertBranch(db, {
    id,
    projectId: params.projectId,
    name: params.branchName,
  });
  const [settledInsert] = await Promise.allSettled([insertResult]);

  if (settledInsert.status === "fulfilled") {
    return { id, created: true };
  }

  if (!isUniqueConstraintError(settledInsert.reason)) {
    await insertResult;
    return { id, created: true };
  }

  const branch = await findBranchByProjectAndName(db, params.projectId, params.branchName);
  if (branch !== null) {
    return { id: branch.id, created: false };
  }

  await insertResult;
  return { id, created: true };
};

const resolveChannel = async (
  db: D1Database,
  params: {
    readonly existingChannel: ChannelRow | null;
    readonly projectId: string;
    readonly branchName: string;
    readonly branchId: string;
  },
): Promise<InsertResolution> => {
  if (params.existingChannel !== null) {
    return { id: params.existingChannel.id, created: false };
  }

  const id = crypto.randomUUID();
  const insertResult = insertChannel(db, {
    id,
    projectId: params.projectId,
    name: params.branchName,
    branchId: params.branchId,
  });
  const [settledInsert] = await Promise.allSettled([insertResult]);

  if (settledInsert.status === "fulfilled") {
    return { id, created: true };
  }

  if (!isUniqueConstraintError(settledInsert.reason)) {
    await insertResult;
    return { id, created: true };
  }

  const channel = await findChannelByProjectAndName(db, params.projectId, params.branchName);
  if (channel !== null) {
    return { id: channel.id, created: false };
  }

  await insertResult;
  return { id, created: true };
};

const ensureBranchChannel = async (
  db: D1Database,
  params: { readonly projectId: string; readonly branchName: string },
): Promise<CoordinatorResult<EnsureBranchChannelResult>> => {
  const [existingBranch, existingChannel] = await Promise.all([
    findBranchByProjectAndName(db, params.projectId, params.branchName),
    findChannelByProjectAndName(db, params.projectId, params.branchName),
  ]);

  const invalidState = getExistingMismatch(existingBranch, existingChannel, params.branchName);
  if (invalidState !== null) {
    return conflict(invalidState);
  }

  const branch = await resolveBranch(db, {
    existingBranch,
    projectId: params.projectId,
    branchName: params.branchName,
  });
  const channel = await resolveChannel(db, {
    existingChannel,
    projectId: params.projectId,
    branchName: params.branchName,
    branchId: branch.id,
  });
  const resolvedChannel = await findChannelById(db, channel.id);

  if (resolvedChannel === null || resolvedChannel.branchId !== branch.id) {
    return conflict(channelLinkedElsewhereMessage(params.branchName));
  }

  return success({
    branchId: branch.id,
    branchCreated: branch.created,
    channelId: channel.id,
    channelCreated: channel.created,
  });
};

const findPreviousLaunchHash = async (
  db: D1Database,
  params: {
    readonly branchId: string;
    readonly platform: "ios" | "android";
    readonly runtimeVersion: string;
  },
): Promise<string | null> => {
  const row = await db
    .prepare(
      `SELECT ua."asset_hash" AS "assetHash" FROM "updates" u JOIN "update_assets" ua ON ua."update_id" = u."id" AND ua."is_launch" = 1 WHERE u."branch_id" = ? AND u."platform" = ? AND u."runtime_version" = ? AND u."is_rollback" = 0 ORDER BY u."created_at" DESC, u."id" DESC LIMIT 1`,
    )
    .bind(params.branchId, params.platform, params.runtimeVersion)
    .first<LaunchAssetRow>();

  return row?.assetHash ?? null;
};

const hasActiveRollout = async (
  db: D1Database,
  params: {
    readonly branchId: string;
    readonly platform: "ios" | "android";
    readonly runtimeVersion: string;
  },
): Promise<boolean> => {
  const row = await db
    .prepare(
      `SELECT "rollout_percentage" AS "rolloutPercentage" FROM "updates" WHERE "branch_id" = ? AND "platform" = ? AND "runtime_version" = ? ORDER BY "created_at" DESC, "id" DESC LIMIT 1`,
    )
    .bind(params.branchId, params.platform, params.runtimeVersion)
    .first<LatestRolloutRow>();

  return row !== null && row.rolloutPercentage > 0 && row.rolloutPercentage < 100;
};

const buildSerializedUpdate = (params: PublishRecord): SerializedUpdate => ({
  id: params.id,
  branchId: params.branchId,
  runtimeVersion: params.runtimeVersion,
  platform: params.platform,
  message: params.message,
  metadataJson: params.metadataJson,
  extraJson: params.extraJson,
  groupId: params.groupId,
  rolloutPercentage: params.rolloutPercentage,
  isRollback: params.isRollback,
  signature: params.signature,
  certificateChain: params.certificateChain,
  manifestBody: params.manifestBody,
  directiveBody: params.directiveBody,
  createdAt: params.createdAt,
});

const insertUpdateWithAssets = async (
  db: D1Database,
  params: PublishRecord,
): Promise<SerializedUpdate> => {
  await db.batch([
    db
      .prepare(
        `INSERT INTO "updates" ("id", "branch_id", "runtime_version", "platform", "message", "metadata_json", "extra_json", "group_id", "rollout_percentage", "is_rollback", "signature", "certificate_chain", "manifest_body", "directive_body", "created_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        params.id,
        params.branchId,
        params.runtimeVersion,
        params.platform,
        params.message,
        params.metadataJson,
        params.extraJson,
        params.groupId,
        params.rolloutPercentage,
        params.isRollback ? 1 : 0,
        params.signature,
        params.certificateChain,
        params.manifestBody,
        params.directiveBody,
        params.createdAt,
      ),
    ...params.assets.map((asset) =>
      db
        .prepare(
          `INSERT INTO "update_assets" ("update_id", "asset_key", "asset_hash", "is_launch") VALUES (?, ?, ?, ?)`,
        )
        .bind(params.id, asset.key, asset.hash, asset.isLaunch ? 1 : 0),
    ),
  ]);

  return buildSerializedUpdate(params);
};

const getNextLaunchHash = (params: {
  readonly isRollback: boolean;
  readonly assets: readonly SerializedAssetRef[];
}): string | null =>
  params.isRollback ? null : (params.assets.find((asset) => asset.isLaunch)?.hash ?? null);

const enqueuePatchJobSafely = async (
  env: Env,
  params: { readonly previousLaunchHash: string; readonly nextLaunchHash: string },
): Promise<void> => {
  const [result] = await Promise.allSettled([
    env.PATCH_QUEUE.send({
      oldHash: params.previousLaunchHash,
      newHash: params.nextLaunchHash,
    }),
  ]);

  if (result.status === "rejected") {
    console.error("[patch-queue] failed to enqueue patch job", result.reason);
  }
};

const schedulePatchGeneration = (
  ctx: DurableObjectState,
  env: Env,
  params: { readonly previousLaunchHash: string | null; readonly nextLaunchHash: string | null },
): void => {
  if (
    params.previousLaunchHash === null ||
    params.nextLaunchHash === null ||
    params.previousLaunchHash === params.nextLaunchHash
  ) {
    return;
  }

  ctx.waitUntil(
    enqueuePatchJobSafely(env, {
      previousLaunchHash: params.previousLaunchHash,
      nextLaunchHash: params.nextLaunchHash,
    }),
  );
};

const publishUpdate = async (
  ctx: DurableObjectState,
  env: Env,
  params: PublishOperation,
): Promise<CoordinatorResult<SerializedUpdate>> => {
  const activeRollout = await hasActiveRollout(env.DB, {
    branchId: params.branchId,
    platform: params.platform,
    runtimeVersion: params.runtimeVersion,
  });
  if (activeRollout) {
    return conflict(params.conflictMessage);
  }

  const previousLaunchHash = await findPreviousLaunchHash(env.DB, {
    branchId: params.branchId,
    platform: params.platform,
    runtimeVersion: params.runtimeVersion,
  });
  const update = await insertUpdateWithAssets(env.DB, {
    ...params,
    id: crypto.randomUUID(),
    createdAt: nowIso(),
  });

  schedulePatchGeneration(ctx, env, {
    previousLaunchHash,
    nextLaunchHash: getNextLaunchHash(params),
  });

  await bumpChannelCacheVersionByBranchReference(env.DB, params.branchId);

  return success(update);
};

export class CreateBranchCoordinator extends SerializedCoordinator {
  async ensureBranchChannel(params: {
    readonly projectId: string;
    readonly branchName: string;
  }): Promise<CoordinatorResult<EnsureBranchChannelResult>> {
    const db = this.env.DB;
    return this.runExclusive(async () => ensureBranchChannel(db, params));
  }
}

export class PublishCoordinator extends SerializedCoordinator {
  async createUpdate(params: CreateUpdateRequest): Promise<CoordinatorResult<SerializedUpdate>> {
    const { ctx } = this;
    const { env } = this;

    return this.runExclusive(async () =>
      publishUpdate(ctx, env, {
        ...params,
        conflictMessage: CREATE_ROLLOUT_CONFLICT_MESSAGE,
      }),
    );
  }

  async republishUpdate(
    params: RepublishUpdateRequest,
  ): Promise<CoordinatorResult<SerializedUpdate>> {
    const { ctx } = this;
    const { env } = this;

    return this.runExclusive(async () =>
      publishUpdate(ctx, env, {
        ...params,
        groupId: crypto.randomUUID(),
        rolloutPercentage: 100,
        isRollback: false,
        conflictMessage: REPUBLISH_ROLLOUT_CONFLICT_MESSAGE,
      }),
    );
  }
}
