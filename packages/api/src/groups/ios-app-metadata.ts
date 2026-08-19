import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { idParam } from "../domain/common";
import { BadRequest, Conflict } from "../domain/errors";
import {
  CreateIosAppMetadataBody,
  DeleteIosAppMetadataResult,
  IosAppMetadata,
  UpdateIosAppMetadataBody,
} from "../domain/ios-app-metadata";

const projectIdParam = { projectId: Schema.String };

export const IosAppMetadataGroup = HttpApiGroup.make("iosAppMetadata")
  .add(
    HttpApiEndpoint.get("list", "/api/projects/:projectId/ios-app-metadata", {
      params: { ...projectIdParam },
      success: Schema.Struct({ items: Schema.Array(IosAppMetadata) }),
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "List iOS App Store metadata",
        description: "List App Store Connect metadata entries for a project",
      }),
    ),
    HttpApiEndpoint.post("create", "/api/projects/:projectId/ios-app-metadata", {
      params: { ...projectIdParam },
      payload: CreateIosAppMetadataBody,
      success: IosAppMetadata.pipe(HttpApiSchema.status(201)),
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Create iOS App Store metadata",
        description: "Register App Store Connect metadata for a bundle identifier",
      }),
    ),
    HttpApiEndpoint.put("update", "/api/ios-app-metadata/:id", {
      params: { ...idParam },
      payload: UpdateIosAppMetadataBody,
      success: IosAppMetadata,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Update iOS App Store metadata",
        description: "Change ASC app id / sku / language / company name / app name",
      }),
    ),
    HttpApiEndpoint.make("DELETE")("delete", "/api/ios-app-metadata/:id", {
      params: { ...idParam },
      success: DeleteIosAppMetadataResult,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Delete iOS App Store metadata",
        description: "Remove an App Store metadata entry",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "iOS App Store metadata",
      description: "Per-project per-bundle App Store Connect metadata for submissions",
    }),
  );
