// The coordinators are this Worker's own Durable Object classes, reached
// through its loopback bindings rather than an `env` binding.
import { exports as workerExports } from "cloudflare:workers";
import { Context, Effect, Layer } from "effect";

import type {
  CoordinatorResult,
  CreateUpdateRequest,
  EnsureBranchChannelResult as DurableEnsureBranchChannelResult,
  RepublishUpdateRequest,
  SerializedUpdate,
} from "../durable-objects/publish-types";

export type EnsureBranchChannelResult = CoordinatorResult<DurableEnsureBranchChannelResult>;

export type PublishUpdateResult<TValue> = CoordinatorResult<TValue>;

export interface UpdateCoordinatorService {
  readonly ensureBranchChannel: (params: {
    readonly projectId: string;
    readonly branchName: string;
  }) => Effect.Effect<EnsureBranchChannelResult>;
  readonly createUpdate: (params: {
    readonly coordinatorName: string;
    readonly payload: CreateUpdateRequest;
  }) => Effect.Effect<PublishUpdateResult<SerializedUpdate>>;
  readonly republishUpdate: (params: {
    readonly coordinatorName: string;
    readonly payload: RepublishUpdateRequest;
  }) => Effect.Effect<PublishUpdateResult<readonly SerializedUpdate[]>>;
}

export class UpdateCoordinator extends Context.Service<
  UpdateCoordinator,
  UpdateCoordinatorService
>()("server/UpdateCoordinator") {}

export const UpdateCoordinatorLive = Layer.succeed(UpdateCoordinator, {
  ensureBranchChannel: (params) =>
    Effect.gen(function* () {
      const result = yield* Effect.promise(async () =>
        workerExports.CreateBranchCoordinator.getByName(
          `${params.projectId}:${params.branchName}`,
        ).ensureBranchChannel({
          projectId: params.projectId,
          branchName: params.branchName,
        }),
      );
      return result.ok
        ? {
            ok: true as const,
            value: result.value,
          }
        : {
            ok: false as const,
            message: result.message,
          };
    }),

  createUpdate: (params) =>
    Effect.gen(function* () {
      const result = yield* Effect.promise(async () =>
        workerExports.PublishCoordinator.getByName(params.coordinatorName).createUpdate(
          params.payload,
        ),
      );
      return result.ok
        ? { ok: true as const, value: result.value }
        : { ok: false as const, message: result.message };
    }),

  republishUpdate: (params) =>
    Effect.gen(function* () {
      const result = yield* Effect.promise(async () =>
        workerExports.PublishCoordinator.getByName(params.coordinatorName).republishUpdate(
          params.payload,
        ),
      );
      return result.ok
        ? { ok: true as const, value: result.value }
        : { ok: false as const, message: result.message };
    }),
});
