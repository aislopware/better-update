import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import {
  ResolveBuildCredentialsBody,
  ResolveBuildCredentialsResult,
} from "../domain/build-credentials";
import { BadRequest, Conflict } from "../domain/errors";

const projectIdParam = { projectId: Schema.String };

export const BuildCredentialsGroup = HttpApiGroup.make("buildCredentials")
  .add(
    HttpApiEndpoint.post("resolve", "/api/projects/:projectId/build-credentials/resolve", {
      params: { ...projectIdParam },
      payload: ResolveBuildCredentialsBody,
      success: ResolveBuildCredentialsResult,
      error: [NotFound, BadRequest, Forbidden, Conflict],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Resolve build credentials",
        description:
          "Return decrypted signing assets for a project build. Regenerates the iOS provisioning profile via Apple ASC when the registered device roster has changed since the profile was last generated.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Build Credentials",
      description: "Materialize signing assets needed by a CLI build run",
    }),
  );
