import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { BuildWithArtifact } from "../domain/build";
import { Id } from "../domain/common";
import { BadRequest } from "../domain/errors";
import { Update } from "../domain/update";

const projectIdParam = { projectId: Id };
const hashParam = { hash: Schema.String.check(Schema.isMinLength(1)) };

export const FingerprintDetail = Schema.Struct({
  hash: Schema.String,
  projectId: Id,
  builds: Schema.Array(BuildWithArtifact),
  updates: Schema.Array(Update),
});

export const FingerprintsGroup = HttpApiGroup.make("fingerprints").add(
  HttpApiEndpoint.get("get", "/api/projects/:projectId/fingerprints/:hash", {
    params: { ...projectIdParam, ...hashParam },
    success: FingerprintDetail,
    error: [Forbidden, NotFound, BadRequest],
  }).annotateMerge(
    OpenApi.annotations({
      title: "Get fingerprint",
      description:
        "Fetch builds and updates compatible with a given fingerprint hash within a project.",
    }),
  ),
);
