import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";

import { NotFound } from "../auth/ownership";
import { BadRequest, NotAcceptable } from "../domain/errors";

const projectIdParam = { projectId: Schema.String };

export const ManifestGroup = HttpApiGroup.make("manifest")
  .add(
    HttpApiEndpoint.get("serve", "/manifest/:projectId", {
      params: { ...projectIdParam },
      error: [BadRequest, NotFound, NotAcceptable],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Serve manifest",
        description: "Expo Updates protocol v1 manifest endpoint",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Protocol",
      description: "Expo Updates protocol endpoints",
    }),
  );
