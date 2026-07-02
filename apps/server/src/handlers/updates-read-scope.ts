// Effect helpers extracted from handlers/updates.ts to keep it under the
// max-lines budget. Read-scoping: an update's environment is its BRANCH name, so
// reads gate at `project/{id}/env/{branchName}` and lists filter per-branch
// (deny-wins). Plus the create-time asset-existence check.

import { Effect } from "effect";

import { isAllowed, resolvePath } from "../auth/policy-match";
import { BadRequest, Conflict, NotFound } from "../errors";
import { AssetRepo, BranchRepo, ChannelRepo } from "../repositories";

import type { PolicyStatement } from "../authz-models";

// Resolve the branch a patch-base lookup targets: an explicit branchId, or the
// branch currently served by the named channel.
export const resolvePatchBaseBranchId = (params: {
  readonly projectId: string;
  readonly branchId: string | undefined;
  readonly channel: string | undefined;
}) =>
  Effect.gen(function* () {
    if (params.branchId !== undefined) {
      return params.branchId;
    }
    if (params.channel === undefined) {
      return yield* new BadRequest({ message: "Either branchId or channel is required" });
    }
    const channelRepo = yield* ChannelRepo;
    const channel = yield* channelRepo.findByProjectAndName({
      projectId: params.projectId,
      name: params.channel,
    });
    return channel.branchId;
  });

// Keep only the updates whose branch environment the caller may read (deny-wins).
// Loads the project's branches once to map branchId → environment name.
export const filterUpdatesByEnvRead = <T extends { readonly branchId: string }>(params: {
  readonly projectId: string;
  readonly statements: readonly PolicyStatement[];
  readonly updates: readonly T[];
}) =>
  Effect.gen(function* () {
    const branchRepo = yield* BranchRepo;
    const { items: branches } = yield* branchRepo.findByProject({
      projectId: params.projectId,
      sort: "createdAt",
      order: "desc",
      limit: 1000,
      offset: 0,
    });
    const nameByBranchId = new Map(branches.map((branch) => [branch.id, branch.name]));
    return params.updates.filter((update) => {
      const environment = nameByBranchId.get(update.branchId);
      return (
        environment !== undefined &&
        isAllowed(
          params.statements,
          "update:read",
          resolvePath({ kind: "environment", projectId: params.projectId, environment }),
        )
      );
    });
  });

// Reject a create whose referenced assets are missing or not yet uploaded.
export const assertAssetsExist = (assets: readonly { readonly hash: string }[]) =>
  Effect.gen(function* () {
    const assetRepo = yield* AssetRepo;
    const existingAssets = yield* assetRepo.findByHashes({
      hashes: assets.map((asset) => asset.hash),
    });
    const existingHashes = new Set(existingAssets.map((asset) => asset.hash));
    const missingHashes = assets.filter((asset) => !existingHashes.has(asset.hash));
    const pendingHashes = existingAssets
      .filter((asset) => asset.byteSize <= 0)
      .map((asset) => asset.hash);

    if (missingHashes.length > 0) {
      return yield* new NotFound({
        message: `Assets not found: ${missingHashes.map((asset) => asset.hash).join(", ")}`,
      });
    }

    if (pendingHashes.length > 0) {
      return yield* new Conflict({
        message: `Assets not uploaded: ${pendingHashes.join(", ")}`,
      });
    }
  });
