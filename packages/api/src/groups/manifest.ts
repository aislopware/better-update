import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { NotFound } from "../auth/ownership";
import { BadRequest, NotAcceptable } from "../domain/errors";

const projectIdParam = HttpApiSchema.param("projectId", Schema.String);

export class ManifestGroup extends HttpApiGroup.make("manifest")
  .add(
    HttpApiEndpoint.get("serve")`/manifest/${projectIdParam}`
      .addError(BadRequest)
      .addError(NotFound)
      .addError(NotAcceptable)
      .annotateContext(
        OpenApi.annotations({
          title: "Serve manifest",
          description: "Expo Updates protocol v1 manifest endpoint",
        }),
      ),
  )
  .annotateContext(
    OpenApi.annotations({
      title: "Protocol",
      description: "Expo Updates protocol endpoints",
    }),
  ) {}
