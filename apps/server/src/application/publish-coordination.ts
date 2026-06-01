import { Effect } from "effect";

import { toDbNull } from "../lib/nullable";
import { BranchRepo, ChannelRepo, ProjectRepo, UpdateRepo } from "../repositories";
import { clockSkewConflict } from "./clock-skew-guard";

import type {
  CoordinatorResult,
  CreateUpdateRequest,
  EnsureBranchChannelResult,
  RepublishUpdateRequest,
  SerializedAssetRef,
  SerializedUpdate,
} from "../durable-objects/publish-types";
import type { UpdateModel } from "../models";

export type { CoordinatorResult } from "../durable-objects/publish-types";

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
    return yield* repo
      .insert({
        id: branchId,
        projectId: params.projectId,
        name: params.branchName,
        createdAt: nowIso(),
      })
      .pipe(
        Effect.as({ id: branchId, created: true } as const),
        Effect.orElse(() =>
          Effect.gen(function* () {
            const branch = yield* findBranchOptional({
              projectId: params.projectId,
              name: params.branchName,
            });
            if (branch === null) {
              return yield* Effect.dieMessage(
                "Branch conflict detected but branch could not be reloaded",
              );
            }
            return { id: branch.id, created: false } as const;
          }),
        ),
      );
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
    return yield* repo
      .insert({
        projectId: params.projectId,
        name: params.branchName,
        branchId: params.branchId,
      })
      .pipe(
        Effect.map((inserted) => ({ id: inserted.id, created: true }) as const),
        Effect.orElse(() =>
          Effect.gen(function* () {
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
          }),
        ),
      );
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
  fingerprintHash: update.fingerprintHash,
  gitCommit: update.gitCommit,
  gitDirty: update.gitDirty,
  totalAssetSize: update.totalAssetSize,
  createdAt: update.createdAt,
});

const getNextLaunchHash = (params: {
  readonly isRollback: boolean;
  readonly assets: readonly SerializedAssetRef[];
}): string | null =>
  params.isRollback ? null : toDbNull(params.assets.find((asset) => asset.isLaunch)?.hash);

const embeddedIdInUseMessage = (id: string) =>
  `Update id "${id}" is already in use by another update; the embedded baseline id (the binary's app.manifest UUID) must be unique`;

/**
 * Reconcile a pinned embedded-baseline id BEFORE the insert so the PRIMARY KEY
 * write never blows up into a 500. Runs inside the publish DO's single-writer
 * lock, so the read-then-act below has no concurrent writer to race.
 *
 *  • no pinned id / no existing row → proceed (insert as-is).
 *  • existing row, SAME (branch, runtimeVersion, platform) → idempotent
 *    re-register: delete the prior row so the pinned-id insert lands cleanly
 *    (re-uploading the same --embedded-id after a reset/retry/CI step is a
 *    normal operator workflow, not a 500).
 *  • existing row, DIFFERENT tuple (other branch/project, or other rtv/platform)
 *    → Conflict: never overwrite another update's row across the trust boundary.
 *
 * Returns null to proceed, or a conflict message to abort with a clean 409.
 */
const reconcileEmbeddedBaselineId = (params: {
  readonly id: string | undefined;
  readonly branchId: string;
  readonly runtimeVersion: string;
  readonly platform: "ios" | "android";
}) =>
  Effect.gen(function* () {
    if (params.id === undefined) {
      return null;
    }

    const updateRepo = yield* UpdateRepo;
    const existing = yield* updateRepo
      .findById({ id: params.id })
      .pipe(Effect.catchTag("NotFound", () => Effect.succeed(null)));

    if (existing === null) {
      return null;
    }

    const sameTuple =
      existing.branchId === params.branchId &&
      existing.runtimeVersion === params.runtimeVersion &&
      existing.platform === params.platform;

    if (!sameTuple) {
      return embeddedIdInUseMessage(params.id);
    }

    // Same (branch, rtv, platform): idempotent replace under the single-writer
    // lock so the pinned-id insert below does not trip the PK constraint.
    yield* updateRepo.deleteById({ id: params.id });
    return null;
  });

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
    // Re-read by id as a sanity check for D1's ack-but-not-commit window; this
    // Runs inside a Durable Object so there is no concurrent writer to race.
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
    const projectRepo = yield* ProjectRepo;

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

    const isEmbedded = params.isEmbedded ?? false;
    // Exactly one embedded baseline may exist per (branch, runtimeVersion,
    // platform): clear any prior baseline before inserting this one so the
    // partial unique index does not conflict and the client's
    // `expo-embedded-update-id` resolves to the current binary's baseline.
    if (isEmbedded) {
      // Reconcile the pinned app.manifest UUID first: re-registering the SAME
      // embedded id for the SAME tuple is idempotent (replace), but reusing it
      // for a DIFFERENT tuple/project is a clean Conflict — not a PK-collision
      // 500. This runs under the publish DO single-writer lock (no race).
      const embeddedConflict = yield* reconcileEmbeddedBaselineId({
        id: params.id,
        branchId: params.branchId,
        runtimeVersion: params.runtimeVersion,
        platform: params.platform,
      });
      if (embeddedConflict !== null) {
        return conflict<PublishedUpdateEffectResult>(embeddedConflict);
      }

      yield* updateRepo.clearEmbeddedBaseline({
        branchId: params.branchId,
        platform: params.platform,
        runtimeVersion: params.runtimeVersion,
      });
    }

    // Refuse a precomputed publish (signed manifest / rollback directive) whose
    // commitTime would lose to the row the server currently serves on the
    // device's commitTime selection (see clockSkewConflict). Runs under the
    // publish DO single-writer lock, so this read-then-insert has no concurrent
    // writer.
    const skew = yield* clockSkewConflict({
      manifestBody: params.manifestBody,
      directiveBody: params.directiveBody,
      isEmbedded,
      branchId: params.branchId,
      platform: params.platform,
      runtimeVersion: params.runtimeVersion,
    });
    if (skew !== null) {
      return conflict<PublishedUpdateEffectResult>(skew);
    }

    const insertResult = yield* updateRepo
      .insert({
        // Honour a client-chosen id (signed renders bind to it) or let the repo
        // generate one (unsigned path).
        ...(params.id === undefined ? {} : { id: params.id }),
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
        fingerprintHash: params.fingerprintHash,
        gitCommit: params.gitCommit,
        gitDirty: params.gitDirty,
        isEmbedded,
        assets: params.assets,
      })
      // Backstop for the non-embedded pinned-id path (signed renders supply a
      // client id): a PK collision surfaces as a typed Conflict from insert(),
      // converted here to a clean 409 instead of crashing the DO. The embedded
      // path is already reconciled above, so this only fires for a non-embedded
      // pinned-id collision.
      .pipe(Effect.either);

    if (insertResult._tag === "Left") {
      return conflict<PublishedUpdateEffectResult>(insertResult.left.message);
    }
    const update = insertResult.right;

    yield* channelRepo.bumpCacheVersionByBranch({ branchId: params.branchId });
    // Last activity is WHEN the publish happened (server clock), not the row's
    // created_at — which is now the served commitTime and may be back/forward-
    // dated relative to real time under the publishCreatedAt invariant.
    yield* projectRepo.bumpLastActivityByBranch({
      branchId: params.branchId,
      at: nowIso(),
    });

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
    const projectRepo = yield* ProjectRepo;

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

    // Same clock-skew guard as publishUpdate, per destination tuple: a signed
    // republish carries a replacement manifest whose createdAt the CLI re-stamps
    // at republish time, so reject one not strictly newer than the row the
    // destination currently serves. Unsigned republishes get a fresh server-clock
    // created_at and are exempt (servedCommitTime null).
    const skews = yield* Effect.forEach(
      params.updates,
      (update) =>
        clockSkewConflict({
          manifestBody: update.manifestBody,
          directiveBody: update.directiveBody,
          isEmbedded: false,
          branchId: params.branchId,
          platform: update.platform,
          runtimeVersion: update.runtimeVersion,
        }),
      { concurrency: "unbounded" },
    );
    const skew = skews.find((message) => message !== null);
    if (skew) {
      return conflict<RepublishedUpdatesEffectResult>(skew);
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
        signature: toDbNull(update.signature),
        certificateChain: toDbNull(update.certificateChain),
        manifestBody: toDbNull(update.manifestBody),
        directiveBody: toDbNull(update.directiveBody),
        fingerprintHash: toDbNull(update.fingerprintHash),
        assets: update.assets,
      })),
    });

    yield* channelRepo.bumpCacheVersionByBranch({ branchId: params.branchId });
    // Last activity is the republish moment (server clock), not a row created_at
    // — those now carry served commitTimes that may be back/forward-dated.
    if (updates.length > 0) {
      yield* projectRepo.bumpLastActivityByBranch({
        branchId: params.branchId,
        at: nowIso(),
      });
    }

    return success({
      updates: updates.map(toSerializedUpdate),
    });
  });
