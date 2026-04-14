import { Effect } from "effect";

import { BranchRepo, ChannelRepo, UpdateRepo } from "../repositories";

import type {
  CreateUpdateRequest,
  EnsureBranchChannelResult,
  RepublishUpdateRequest,
  SerializedAssetRef,
  SerializedUpdate,
} from "../durable-objects/publish-types";
import type { UpdateModel } from "../models";

interface CoordinatorFailure {
  readonly ok: false;
  readonly message: string;
}

interface CoordinatorSuccess<Value> {
  readonly ok: true;
  readonly value: Value;
}

export type CoordinatorResult<Value> = CoordinatorFailure | CoordinatorSuccess<Value>;

export interface PublishedUpdateEffectResult {
  readonly update: SerializedUpdate;
  readonly previousLaunchHash: string | null;
  readonly nextLaunchHash: string | null;
}

export interface RepublishedUpdatesEffectResult {
  readonly updates: readonly SerializedUpdate[];
}

interface PublishOperation extends CreateUpdateRequest {
  readonly conflictMessage: string;
}

const channelLinkedElsewhereMessage = (branchName: string) =>
  `Channel "${branchName}" already exists and points to a different branch`;

const channelAlreadyExistsMessage = (branchName: string) =>
  `Channel "${branchName}" already exists in this project`;

const conflict = <Value>(message: string): CoordinatorResult<Value> => ({ ok: false, message });

const success = <Value>(value: Value): CoordinatorResult<Value> => ({ ok: true, value });

const nowIso = (): string => new Date().toISOString();

const findBranchOptional = (params: { readonly projectId: string; readonly name: string }) =>
  Effect.gen(function* () {
    const repo = yield* BranchRepo;
    return yield* repo
      .findByProjectAndName(params)
      .pipe(Effect.catchTag("NotFound", () => Effect.succeed(null)));
  });

const findChannelOptional = (params: { readonly projectId: string; readonly name: string }) =>
  Effect.gen(function* () {
    const repo = yield* ChannelRepo;
    return yield* repo
      .findByProjectAndName(params)
      .pipe(Effect.catchTag("NotFound", () => Effect.succeed(null)));
  });

const findChannelByIdOptional = (params: { readonly id: string }) =>
  Effect.gen(function* () {
    const repo = yield* ChannelRepo;
    return yield* repo
      .findById(params)
      .pipe(Effect.catchTag("NotFound", () => Effect.succeed(null)));
  });

const resolveBranch = (params: {
  readonly existingBranch: { readonly id: string } | null;
  readonly projectId: string;
  readonly branchName: string;
}) =>
  Effect.gen(function* () {
    if (params.existingBranch !== null) {
      return { id: params.existingBranch.id, created: false } as const;
    }

    const repo = yield* BranchRepo;
    const branchId = crypto.randomUUID();
    const result = yield* repo
      .insert({
        id: branchId,
        projectId: params.projectId,
        name: params.branchName,
        createdAt: nowIso(),
      })
      .pipe(Effect.either);

    if (result._tag === "Right") {
      return { id: branchId, created: true } as const;
    }

    const branch = yield* findBranchOptional({
      projectId: params.projectId,
      name: params.branchName,
    });

    if (branch === null) {
      return yield* Effect.dieMessage("Branch conflict detected but branch could not be reloaded");
    }

    return { id: branch.id, created: false } as const;
  });

const resolveChannel = (params: {
  readonly existingChannel: { readonly id: string } | null;
  readonly projectId: string;
  readonly branchName: string;
  readonly branchId: string;
}) =>
  Effect.gen(function* () {
    if (params.existingChannel !== null) {
      return { id: params.existingChannel.id, created: false } as const;
    }

    const repo = yield* ChannelRepo;
    const result = yield* repo
      .insert({
        projectId: params.projectId,
        name: params.branchName,
        branchId: params.branchId,
      })
      .pipe(Effect.either);

    if (result._tag === "Right") {
      return { id: result.right.id, created: true } as const;
    }

    const channel = yield* findChannelOptional({
      projectId: params.projectId,
      name: params.branchName,
    });

    if (channel === null) {
      return yield* Effect.dieMessage(
        "Channel conflict detected but channel could not be reloaded",
      );
    }

    return { id: channel.id, created: false } as const;
  });

const getExistingMismatch = (
  branch: { readonly id: string } | null,
  channel: { readonly branchId: string } | null,
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

const toSerializedUpdate = (update: UpdateModel): SerializedUpdate => ({
  id: update.id,
  branchId: update.branchId,
  runtimeVersion: update.runtimeVersion,
  platform: update.platform,
  message: update.message,
  metadataJson: update.metadataJson,
  extraJson: update.extraJson,
  groupId: update.groupId,
  rolloutPercentage: update.rolloutPercentage,
  isRollback: update.isRollback,
  signature: update.signature,
  certificateChain: update.certificateChain,
  manifestBody: update.manifestBody,
  directiveBody: update.directiveBody,
  createdAt: update.createdAt,
});

const getNextLaunchHash = (params: {
  readonly isRollback: boolean;
  readonly assets: readonly SerializedAssetRef[];
}): string | null =>
  params.isRollback ? null : (params.assets.find((asset) => asset.isLaunch)?.hash ?? null);

export const ensureBranchChannel = (params: {
  readonly projectId: string;
  readonly branchName: string;
}) =>
  Effect.gen(function* () {
    const [existingBranch, existingChannel] = yield* Effect.all(
      [
        findBranchOptional({ projectId: params.projectId, name: params.branchName }),
        findChannelOptional({ projectId: params.projectId, name: params.branchName }),
      ],
      { concurrency: "unbounded" },
    );

    const invalidState = getExistingMismatch(existingBranch, existingChannel, params.branchName);
    if (invalidState !== null) {
      return conflict<EnsureBranchChannelResult>(invalidState);
    }

    const branch = yield* resolveBranch({
      existingBranch,
      projectId: params.projectId,
      branchName: params.branchName,
    });
    const channel = yield* resolveChannel({
      existingChannel,
      projectId: params.projectId,
      branchName: params.branchName,
      branchId: branch.id,
    });
    const resolvedChannel = yield* findChannelByIdOptional({ id: channel.id });

    if (resolvedChannel === null || resolvedChannel.branchId !== branch.id) {
      return conflict<EnsureBranchChannelResult>(channelLinkedElsewhereMessage(params.branchName));
    }

    return success({
      branchId: branch.id,
      branchCreated: branch.created,
      channelId: channel.id,
      channelCreated: channel.created,
    });
  });

export const publishUpdate = (params: PublishOperation) =>
  Effect.gen(function* () {
    const updateRepo = yield* UpdateRepo;
    const channelRepo = yield* ChannelRepo;

    const activeRollout = yield* updateRepo.hasActiveRollout({
      branchId: params.branchId,
      platform: params.platform,
      runtimeVersion: params.runtimeVersion,
    });

    if (activeRollout) {
      return conflict<PublishedUpdateEffectResult>(params.conflictMessage);
    }

    const previousLaunchHash = yield* updateRepo.findLatestLaunchAssetHash({
      branchId: params.branchId,
      platform: params.platform,
      runtimeVersion: params.runtimeVersion,
    });
    const update = yield* updateRepo.insert({
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
      assets: params.assets,
    });

    yield* channelRepo.bumpCacheVersionByBranch({ branchId: params.branchId });

    return success({
      update: toSerializedUpdate(update),
      previousLaunchHash,
      nextLaunchHash: getNextLaunchHash(params),
    });
  });

export const republishUpdate = (
  params: RepublishUpdateRequest & { readonly conflictMessage: string },
) =>
  Effect.gen(function* () {
    const updateRepo = yield* UpdateRepo;
    const channelRepo = yield* ChannelRepo;

    const rolloutStates = yield* Effect.forEach(
      params.updates,
      (update) =>
        updateRepo.hasActiveRollout({
          branchId: params.branchId,
          platform: update.platform,
          runtimeVersion: update.runtimeVersion,
        }),
      { concurrency: "unbounded" },
    );

    if (rolloutStates.some(Boolean)) {
      return conflict<RepublishedUpdatesEffectResult>(params.conflictMessage);
    }

    const updates = yield* updateRepo.insertBatch({
      branchId: params.branchId,
      groupId: crypto.randomUUID(),
      updates: params.updates.map((update) => ({
        runtimeVersion: update.runtimeVersion,
        platform: update.platform,
        message: params.message ?? update.message,
        metadataJson: update.metadataJson,
        extraJson: update.extraJson,
        rolloutPercentage: 100,
        isRollback: false,
        signature: null,
        certificateChain: null,
        manifestBody: null,
        directiveBody: null,
        assets: update.assets,
      })),
    });

    yield* channelRepo.bumpCacheVersionByBranch({ branchId: params.branchId });

    return success({
      updates: updates.map(toSerializedUpdate),
    });
  });
