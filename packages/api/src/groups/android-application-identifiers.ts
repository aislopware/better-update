import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import {
  AndroidApplicationIdentifier,
  CreateAndroidApplicationIdentifierBody,
  DeleteAndroidApplicationIdentifierResult,
} from "../domain/android-application-identifier";
import { idParam } from "../domain/common";
import { BadRequest, Conflict } from "../domain/errors";

const projectIdParam = { projectId: Schema.String };

export const AndroidApplicationIdentifiersGroup = HttpApiGroup.make("androidApplicationIdentifiers")
  .add(
    HttpApiEndpoint.get("list", "/api/projects/:projectId/android-application-identifiers", {
      params: { ...projectIdParam },
      success: Schema.Struct({ items: Schema.Array(AndroidApplicationIdentifier) }),
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "List Android application identifiers",
        description: "List all Android package identifiers for a project",
      }),
    ),
    HttpApiEndpoint.post("create", "/api/projects/:projectId/android-application-identifiers", {
      params: { ...projectIdParam },
      payload: CreateAndroidApplicationIdentifierBody,
      success: AndroidApplicationIdentifier.pipe(HttpApiSchema.status(201)),
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Create Android application identifier",
        description: "Register an Android package name for a project",
      }),
    ),
    HttpApiEndpoint.make("DELETE")("delete", "/api/android-application-identifiers/:id", {
      params: { ...idParam },
      success: DeleteAndroidApplicationIdentifierResult,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Delete Android application identifier",
        description: "Remove an Android application identifier",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Android Application Identifiers",
      description: "Manage Android package name registrations per project",
    }),
  );
