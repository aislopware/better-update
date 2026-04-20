import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import {
  AndroidBuildCredentials,
  CreateAndroidBuildCredentialsBody,
  DeleteAndroidBuildCredentialsResult,
  UpdateAndroidBuildCredentialsBody,
} from "../domain/android-build-credentials";
import { BadRequest, Conflict } from "../domain/errors";

const idParam = HttpApiSchema.param("id", Schema.String);
const applicationIdentifierIdParam = HttpApiSchema.param("applicationIdentifierId", Schema.String);

export class AndroidBuildCredentialsGroup extends HttpApiGroup.make("androidBuildCredentials")
  .add(
    HttpApiEndpoint.get(
      "list",
    )`/api/android-application-identifiers/${applicationIdentifierIdParam}/build-credentials`
      .addSuccess(Schema.Struct({ items: Schema.Array(AndroidBuildCredentials) }))
      .annotateContext(
        OpenApi.annotations({
          title: "List Android build credentials",
          description: "List named build credential groups for an Android app identifier",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post(
      "create",
    )`/api/android-application-identifiers/${applicationIdentifierIdParam}/build-credentials`
      .setPayload(CreateAndroidBuildCredentialsBody)
      .addSuccess(AndroidBuildCredentials, { status: 201 })
      .annotateContext(
        OpenApi.annotations({
          title: "Create Android build credentials group",
          description: "Create a named build credentials group (Default or custom)",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.put("update")`/api/android-build-credentials/${idParam}`
      .setPayload(UpdateAndroidBuildCredentialsBody)
      .addSuccess(AndroidBuildCredentials)
      .annotateContext(
        OpenApi.annotations({
          title: "Update Android build credentials",
          description: "Rename group, change default flag, or swap bound keystore/keys",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("delete")`/api/android-build-credentials/${idParam}`
      .addSuccess(DeleteAndroidBuildCredentialsResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Delete Android build credentials",
          description: "Remove a build credentials group",
        }),
      ),
  )
  .addError(NotFound)
  .addError(Conflict)
  .addError(BadRequest)
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "Android Build Credentials",
      description: "Named groups of build credentials per Android application identifier",
    }),
  ) {}
