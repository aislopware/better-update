import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { ManagementApi } from "../api";
import { assertProjectOwnership } from "../auth/ownership";
import { assertAccess } from "../auth/policy";
import { toApiBuild, toApiUpdate } from "../http/to-api";
import { toApiBadRequestReadEffect } from "../http/to-api-effect";
import { BuildRepo, UpdateRepo } from "../repositories";

export const FingerprintsGroupLive = HttpApiBuilder.group(
  ManagementApi,
  "fingerprints",
  (handlers) =>
    handlers.handle("get", ({ params }) =>
      toApiBadRequestReadEffect(
        Effect.gen(function* () {
          yield* assertProjectOwnership(params.projectId);
          yield* assertAccess("build", "read", { kind: "build", projectId: params.projectId });

          const [buildRepo, updateRepo] = yield* Effect.all([BuildRepo, UpdateRepo]);
          const [builds, updates] = yield* Effect.all(
            [
              buildRepo.listByProjectAndFingerprint({
                projectId: params.projectId,
                fingerprintHash: params.hash,
              }),
              updateRepo.listByProjectAndFingerprint({
                projectId: params.projectId,
                fingerprintHash: params.hash,
              }),
            ],
            { concurrency: "unbounded" },
          );

          return {
            hash: params.hash,
            projectId: params.projectId,
            builds: builds.map(toApiBuild),
            updates: updates.map(toApiUpdate),
          };
        }),
      ),
    ),
);
