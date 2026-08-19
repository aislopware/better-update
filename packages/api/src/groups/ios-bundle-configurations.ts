import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { idParam } from "../domain/common";
import { BadRequest, Conflict } from "../domain/errors";
import {
  CreateIosBundleConfigurationBody,
  DeleteIosBundleConfigurationResult,
  IosBundleConfiguration,
  UpdateIosBundleConfigurationBody,
} from "../domain/ios-bundle-configuration";

const projectIdParam = { projectId: Schema.String };

export const IosBundleConfigurationsGroup = HttpApiGroup.make("iosBundleConfigurations")
  .add(
    HttpApiEndpoint.get("list", "/api/projects/:projectId/ios-bundle-configurations", {
      params: { ...projectIdParam },
      success: Schema.Struct({ items: Schema.Array(IosBundleConfiguration) }),
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "List iOS bundle configurations",
        description: "List all iOS bundle configurations for a project",
      }),
    ),
    HttpApiEndpoint.post("create", "/api/projects/:projectId/ios-bundle-configurations", {
      params: { ...projectIdParam },
      payload: CreateIosBundleConfigurationBody,
      success: IosBundleConfiguration.pipe(HttpApiSchema.status(201)),
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Create iOS bundle configuration",
        description: "Bind certificate + profile + push + ASC to a bundle identifier",
      }),
    ),
    HttpApiEndpoint.put("update", "/api/ios-bundle-configurations/:id", {
      params: { ...idParam },
      payload: UpdateIosBundleConfigurationBody,
      success: IosBundleConfiguration,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Update iOS bundle configuration",
        description: "Change the credentials bound to an iOS bundle configuration",
      }),
    ),
    HttpApiEndpoint.make("DELETE")("delete", "/api/ios-bundle-configurations/:id", {
      params: { ...idParam },
      success: DeleteIosBundleConfigurationResult,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Delete iOS bundle configuration",
        description: "Remove an iOS bundle configuration binding",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "iOS Bundle Configurations",
      description: "Per-project per-bundle credential bindings",
    }),
  );
