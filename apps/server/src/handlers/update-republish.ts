import { safeJsonParse } from "@better-update/safe-json";
import { isRecord } from "@better-update/type-guards";
import { Effect } from "effect";
import { countBy, uniq } from "es-toolkit";

import type { RepublishBody } from "@better-update/api";

import { assertProjectOwnership } from "../auth/ownership";
import { verifySignedUpdate } from "../domain/signed-update-verification";
import { validateUpdatePublishInput } from "../domain/update-publish-validation";
import { BadRequest, NotFound } from "../errors";
import { toDbNull } from "../lib/nullable";
import { requireValue } from "../lib/require-value";
import { BranchRepo, ChannelRepo, UpdateRepo } from "../repositories";

type RepublishPayload = typeof RepublishBody.Type;

interface RepublishSourceUpdateWithAssets {
  readonly update: {
    readonly id: string;
    readonly branchId: string;
    readonly runtimeVersion: string;
    readonly platform: "ios" | "android";
    readonly message: string;
    readonly metadataJson: string;
    readonly extraJson: string | null;
    readonly signature: string | null;
    readonly certificateChain: string | null;
    readonly manifestBody: string | null;
    readonly directiveBody: string | null;
    readonly fingerprintHash: string | null;
    readonly isRollback: boolean;
  };
  readonly assets: readonly {
    readonly key: string;
    readonly hash: string;
    readonly isLaunch: boolean;
    readonly contentChecksum?: string | undefined;
  }[];
}

const fail = (message: string) => new BadRequest({ message });

const assertExactlyOneDefined = (params: {
  readonly values: readonly [unknown, unknown];
  readonly message: string;
}) => {
  const definedCount = params.values.filter((value) => value !== undefined).length;
  return definedCount === 1 ? Effect.void : Effect.fail(fail(params.message));
};

const getUpdateAssets = (updateId: string) =>
  Effect.gen(function* () {
    const repo = yield* UpdateRepo;
    return yield* repo.findAssetsByUpdateId({ updateId });
  });

const isSignedOrPrecomputedUpdate = (update: {
  readonly signature: string | null;
  readonly certificateChain: string | null;
  readonly manifestBody: string | null;
  readonly directiveBody: string | null;
}) =>
  update.signature !== null ||
  update.certificateChain !== null ||
  update.manifestBody !== null ||
  update.directiveBody !== null;

const parseExtraJson = (extraJson: string | null): Record<string, unknown> | undefined => {
  if (extraJson === null) {
    return undefined;
  }

  const parsed = safeJsonParse(extraJson);
  return isRecord(parsed) ? parsed : undefined;
};

const resolveSignedRepublishOverrides = (payload: RepublishPayload) =>
  Effect.gen(function* () {
    const overrides = payload.signedUpdates ?? [];
    const duplicateSourceUpdateIds = Object.entries(
      countBy(overrides, (override) => override.sourceUpdateId),
    )
      .filter(([, count]) => count > 1)
      .map(([id]) => id);

    if (duplicateSourceUpdateIds.length > 0) {
      yield* fail(
        `signedUpdates must contain unique sourceUpdateId values: ${duplicateSourceUpdateIds.join(", ")}`,
      );
    }

    return new Map(overrides.map((override) => [override.sourceUpdateId, override] as const));
  });

export const prepareRepublishUpdates = (params: {
  readonly payload: RepublishPayload;
  readonly sourceUpdates: readonly RepublishSourceUpdateWithAssets[];
}) =>
  Effect.gen(function* () {
    const overridesBySourceId = yield* resolveSignedRepublishOverrides(params.payload);
    const sourceIds = new Set(params.sourceUpdates.map(({ update }) => update.id));
    const unknownSourceIds = [...overridesBySourceId.keys()].filter((id) => !sourceIds.has(id));
    if (unknownSourceIds.length > 0) {
      yield* fail(
        `signedUpdates contain unknown sourceUpdateId values: ${unknownSourceIds.join(", ")}`,
      );
    }

    const missingSignedOverrides = params.sourceUpdates
      .filter(({ update }) => isSignedOrPrecomputedUpdate(update))
      .map(({ update }) => update.id)
      .filter((id) => !overridesBySourceId.has(id));

    if (missingSignedOverrides.length > 0) {
      yield* fail(
        `Signed or precomputed source updates require replacement signed manifests: ${missingSignedOverrides.join(", ")}`,
      );
    }

    return yield* Effect.forEach(
      params.sourceUpdates,
      ({ update, assets }) =>
        Effect.gen(function* () {
          const override = overridesBySourceId.get(update.id);
          if (override !== undefined) {
            yield* validateUpdatePublishInput({
              runtimeVersion: update.runtimeVersion,
              assets,
              extra: parseExtraJson(update.extraJson),
              isRollback: false,
              manifestBody: override.manifestBody,
              directiveBody: null,
            });

            // SECURITY GATE: validateUpdatePublishInput only checks SHAPE (JSON +
            // asset/runtime/extra match), NOT the signature. Verify the override's
            // signature against its certificate over the EXACT manifest body bytes
            // before persisting — mirroring handlers/updates.ts so a non-verifying
            // or wrong-alg (e.g. ECDSA) republished signed update is rejected with
            // BadRequest and never stored as permanently-unverifiable on-device.
            yield* verifySignedUpdate({
              signature: override.signature,
              certificateChain: override.certificateChain,
              manifestBody: override.manifestBody,
              directiveBody: null,
            });

            return {
              runtimeVersion: update.runtimeVersion,
              platform: update.platform,
              message: update.message,
              metadataJson: update.metadataJson,
              extraJson: update.extraJson,
              signature: override.signature,
              certificateChain: override.certificateChain,
              manifestBody: override.manifestBody,
              directiveBody: null,
              fingerprintHash: update.fingerprintHash,
              assets,
            } as const;
          }

          return {
            runtimeVersion: update.runtimeVersion,
            platform: update.platform,
            message: update.message,
            metadataJson: update.metadataJson,
            extraJson: update.extraJson,
            signature: null,
            certificateChain: null,
            manifestBody: null,
            directiveBody: null,
            fingerprintHash: update.fingerprintHash,
            assets,
          } as const;
        }),
      { concurrency: 1 },
    );
  });

export const resolveRepublishSource = ({ payload }: { readonly payload: RepublishPayload }) =>
  Effect.gen(function* () {
    yield* assertExactlyOneDefined({
      values: [payload.sourceUpdateId, payload.sourceGroupId],
      message: "Provide exactly one of sourceUpdateId or sourceGroupId",
    });

    const updateRepo = yield* UpdateRepo;
    const branchRepo = yield* BranchRepo;
    const sourceUpdates = payload.sourceUpdateId
      ? [yield* updateRepo.findById({ id: payload.sourceUpdateId })]
      : yield* Effect.gen(function* () {
          const groupId = yield* requireValue(payload.sourceGroupId, "sourceGroupId");
          const updates = yield* updateRepo.findByGroupId({ groupId });
          if (updates.length === 0) {
            return yield* new NotFound({ message: "Update group not found" });
          }
          return updates;
        });

    const sourceBranches = yield* Effect.forEach(
      sourceUpdates,
      (update) => branchRepo.findById({ id: update.branchId }),
      { concurrency: "unbounded" },
    );
    const projectIds = uniq(sourceBranches.map((branch) => branch.projectId));
    if (projectIds.length !== 1) {
      yield* fail("All source updates must belong to the same project");
    }
    const sourceProjectId = yield* requireValue(projectIds[0], "projectId");

    yield* assertProjectOwnership(sourceProjectId);

    if (sourceUpdates.some((update) => update.isRollback)) {
      yield* fail("Cannot republish a rollback directive");
    }

    const sourceUpdatesWithAssets = yield* Effect.forEach(
      sourceUpdates,
      (update) =>
        Effect.map(getUpdateAssets(update.id), (assets) => ({
          update,
          assets,
        })),
      { concurrency: "unbounded" },
    );

    return {
      projectId: sourceProjectId,
      sourceUpdates: sourceUpdatesWithAssets.toSorted((left, right) =>
        left.update.platform.localeCompare(right.update.platform),
      ),
    };
  });

export const resolveRepublishDestination = (params: {
  readonly payload: RepublishPayload;
  readonly projectId: string;
}) =>
  Effect.gen(function* () {
    yield* assertExactlyOneDefined({
      values: [params.payload.destinationBranchId, params.payload.destinationChannel],
      message: "Provide exactly one of destinationBranchId or destinationChannel",
    });

    const branchRepo = yield* BranchRepo;
    const channelRepo = yield* ChannelRepo;

    if (params.payload.destinationBranchId) {
      const destinationBranch = yield* branchRepo.findById({
        id: params.payload.destinationBranchId,
      });
      if (destinationBranch.projectId !== params.projectId) {
        yield* fail("Source and destination must belong to the same project");
      }

      // The owning channel for the destination branch (oldest first). Scoped
      // republish gates on this channel; `null` when the branch has no channel
      // (a branch-only destination), in which case the org-wide baseline applies.
      const owningChannel = yield* channelRepo.findByBranchId({ branchId: destinationBranch.id });

      return {
        branchId: destinationBranch.id,
        channelId: toDbNull(owningChannel?.id),
        auditMetadata: { destinationBranchId: destinationBranch.id },
      };
    }

    const name = yield* requireValue(params.payload.destinationChannel, "destinationChannel");
    const destinationChannel = yield* channelRepo.findByProjectAndName({
      projectId: params.projectId,
      name,
    });

    return {
      branchId: destinationChannel.branchId,
      channelId: destinationChannel.id,
      auditMetadata: {
        destinationBranchId: destinationChannel.branchId,
        destinationChannel: destinationChannel.name,
      },
    };
  });
