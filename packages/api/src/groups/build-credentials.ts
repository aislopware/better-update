import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import {
  ResolveBuildCredentialsBody,
  ResolveBuildCredentialsResult,
} from "../domain/build-credentials";
import { BadRequest, Conflict } from "../domain/errors";

const projectIdParam = HttpApiSchema.param("projectId", Schema.String);

export class BuildCredentialsGroup extends HttpApiGroup.make("buildCredentials")
  .add(
    HttpApiEndpoint.post("resolve")`/api/projects/${projectIdParam}/build-credentials/resolve`
      .setPayload(ResolveBuildCredentialsBody)
      .addSuccess(ResolveBuildCredentialsResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Resolve build credentials",
          description:
            "Return decrypted signing assets for a project build. Regenerates the iOS provisioning profile via Apple ASC when the registered device roster has changed since the profile was last generated.",
        }),
      ),
  )
  .addError(NotFound)
  .addError(BadRequest)
  .addError(Forbidden)
  .addError(Conflict)
  .annotateContext(
    OpenApi.annotations({
      title: "Build Credentials",
      description: "Materialize signing assets needed by a CLI build run",
    }),
  ) {}
