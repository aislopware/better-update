import { Effect } from "effect";

import {
  ensureBranchChannel,
  publishUpdate,
  republishUpdate,
} from "../application/publish-coordination";
import { provideCloudflareEnv } from "../cloudflare/context";
import { ServerInfrastructureLayer } from "../infrastructure-layer";
import { SerializedCoordinator } from "./serialized-coordinator";

import type { ServerInfrastructure } from "../infrastructure-layer";
import type {
  CreateUpdateRequest,
  EnsureBranchChannelResult,
  RepublishUpdateRequest,
  SerializedUpdate,
} from "./publish-types";

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

const runCoordinatorEffect = async <Success>(
  effect: Effect.Effect<Success, never, ServerInfrastructure>,
  env: Env,
) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(ServerInfrastructureLayer), (program) =>
      provideCloudflareEnv(program, env),
    ),
  );

export class CreateBranchCoordinator extends SerializedCoordinator {
  async ensureBranchChannel(params: {
    readonly projectId: string;
    readonly branchName: string;
  }): Promise<CoordinatorResult<EnsureBranchChannelResult>> {
    return this.runExclusive(async () =>
      runCoordinatorEffect(ensureBranchChannel(params), this.env),
    );
  }
}

export class PublishCoordinator extends SerializedCoordinator {
  async createUpdate(params: CreateUpdateRequest): Promise<CoordinatorResult<SerializedUpdate>> {
    return this.runExclusive(async () => {
      const result = await runCoordinatorEffect(
        publishUpdate({
          ...params,
          conflictMessage: CREATE_ROLLOUT_CONFLICT_MESSAGE,
        }),
        this.env,
      );

      if (!result.ok) {
        return result;
      }

      return { ok: true as const, value: result.value.update };
    });
  }

  async republishUpdate(
    params: RepublishUpdateRequest,
  ): Promise<CoordinatorResult<readonly SerializedUpdate[]>> {
    return this.runExclusive(async () => {
      const result = await runCoordinatorEffect(
        republishUpdate({
          ...params,
          conflictMessage: REPUBLISH_ROLLOUT_CONFLICT_MESSAGE,
        }),
        this.env,
      );

      if (!result.ok) {
        return result;
      }

      return { ok: true as const, value: result.value.updates };
    });
  }
}
