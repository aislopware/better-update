import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import {
  AndroidApplicationIdentifier,
  CreateAndroidApplicationIdentifierBody,
  DeleteAndroidApplicationIdentifierResult,
} from "../domain/android-application-identifier";
import { idParam } from "../domain/common";
import { BadRequest, Conflict } from "../domain/errors";

const projectIdParam = HttpApiSchema.param("projectId", Schema.String);

export class AndroidApplicationIdentifiersGroup extends HttpApiGroup.make(
  "androidApplicationIdentifiers",
)
  .add(
    HttpApiEndpoint.get("list")`/api/projects/${projectIdParam}/android-application-identifiers`
      .addSuccess(Schema.Struct({ items: Schema.Array(AndroidApplicationIdentifier) }))
      .annotateContext(
        OpenApi.annotations({
          title: "List Android application identifiers",
          description: "List all Android package identifiers for a project",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("create")`/api/projects/${projectIdParam}/android-application-identifiers`
      .setPayload(CreateAndroidApplicationIdentifierBody)
      .addSuccess(AndroidApplicationIdentifier, { status: 201 })
      .annotateContext(
        OpenApi.annotations({
          title: "Create Android application identifier",
          description: "Register an Android package name for a project",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("delete")`/api/android-application-identifiers/${idParam}`
      .addSuccess(DeleteAndroidApplicationIdentifierResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Delete Android application identifier",
          description: "Remove an Android application identifier",
        }),
      ),
  )
  .addError(NotFound)
  .addError(Conflict)
  .addError(BadRequest)
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "Android Application Identifiers",
      description: "Manage Android package name registrations per project",
    }),
  ) {}
