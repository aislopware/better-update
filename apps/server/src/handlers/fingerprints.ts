import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { assertProjectOwnership } from "../auth/ownership";
import { assertPermission } from "../auth/permissions";
import { toApiBuild, toApiUpdate } from "../http/to-api";
import { toApiBadRequestReadEffect } from "../http/to-api-effect";
import { BuildRepo, UpdateRepo } from "../repositories";

export const FingerprintsGroupLive = HttpApiBuilder.group(
  ManagementApi,
  "fingerprints",
  (handlers) =>
    handlers.handle("get", ({ path }) =>
      toApiBadRequestReadEffect(
        Effect.gen(function* () {
          yield* assertPermission("build", "read");
          yield* assertProjectOwnership(path.projectId);

          const [buildRepo, updateRepo] = yield* Effect.all([BuildRepo, UpdateRepo]);
          const [builds, updates] = yield* Effect.all(
            [
              buildRepo.listByProjectAndFingerprint({
                projectId: path.projectId,
                fingerprintHash: path.hash,
              }),
              updateRepo.listByProjectAndFingerprint({
                projectId: path.projectId,
                fingerprintHash: path.hash,
              }),
            ],
            { concurrency: "unbounded" },
          );

          return {
            hash: path.hash,
            projectId: path.projectId,
            builds: builds.map(toApiBuild),
            updates: updates.map(toApiUpdate),
          };
        }),
      ),
    ),
);
