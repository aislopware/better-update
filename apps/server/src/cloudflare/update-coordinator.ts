import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "./context";

import type {
  CreateUpdateRequest,
  EnsureBranchChannelResult as DurableEnsureBranchChannelResult,
  RepublishUpdateRequest,
  SerializedUpdate,
} from "../durable-objects/publish-types";

export type EnsureBranchChannelResult =
  | {
      readonly ok: true;
      readonly value: DurableEnsureBranchChannelResult;
    }
  | {
      readonly ok: false;
      readonly message: string;
    };

export type PublishUpdateResult<TValue> =
  | {
      readonly ok: true;
      readonly value: TValue;
    }
  | {
      readonly ok: false;
      readonly message: string;
    };

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
  }) => Effect.Effect<PublishUpdateResult<SerializedUpdate>>;
}

export class UpdateCoordinator extends Context.Tag("server/UpdateCoordinator")<
  UpdateCoordinator,
  UpdateCoordinatorService
>() {}

export const UpdateCoordinatorLive = Layer.succeed(UpdateCoordinator, {
  ensureBranchChannel: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const result = yield* Effect.promise(async () =>
        env.CREATE_BRANCH_COORDINATOR.getByName(
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
      const env = yield* cloudflareEnv;
      const result = yield* Effect.promise(async () =>
        env.PUBLISH_COORDINATOR.getByName(params.coordinatorName).createUpdate(params.payload),
      );
      return result.ok
        ? { ok: true as const, value: result.value }
        : { ok: false as const, message: result.message };
    }),

  republishUpdate: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const result = yield* Effect.promise(async () =>
        env.PUBLISH_COORDINATOR.getByName(params.coordinatorName).republishUpdate(params.payload),
      );
      return result.ok
        ? { ok: true as const, value: result.value }
        : { ok: false as const, message: result.message };
    }),
});
