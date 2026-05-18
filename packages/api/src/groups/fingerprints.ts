import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { BuildWithArtifact } from "../domain/build";
import { Id } from "../domain/common";
import { BadRequest } from "../domain/errors";
import { Update } from "../domain/update";

const projectIdParam = HttpApiSchema.param("projectId", Id);
const hashParam = HttpApiSchema.param("hash", Schema.String.pipe(Schema.minLength(1)));

export const FingerprintDetail = Schema.Struct({
  hash: Schema.String,
  projectId: Id,
  builds: Schema.Array(BuildWithArtifact),
  updates: Schema.Array(Update),
});

export class FingerprintsGroup extends HttpApiGroup.make("fingerprints")
  .add(
    HttpApiEndpoint.get("get")`/api/projects/${projectIdParam}/fingerprints/${hashParam}`
      .addSuccess(FingerprintDetail)
      .annotateContext(
        OpenApi.annotations({
          title: "Get fingerprint",
          description:
            "Fetch builds and updates compatible with a given fingerprint hash within a project.",
        }),
      ),
  )
  .addError(Forbidden, { status: 403 })
  .addError(NotFound, { status: 404 })
  .addError(BadRequest, { status: 400 }) {}
