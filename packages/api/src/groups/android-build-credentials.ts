import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import {
  AndroidBuildCredentials,
  CreateAndroidBuildCredentialsBody,
  DeleteAndroidBuildCredentialsResult,
  UpdateAndroidBuildCredentialsBody,
} from "../domain/android-build-credentials";
import { idParam } from "../domain/common";
import { BadRequest, Conflict } from "../domain/errors";

const applicationIdentifierIdParam = { applicationIdentifierId: Schema.String };

export const AndroidBuildCredentialsGroup = HttpApiGroup.make("androidBuildCredentials")
  .add(
    HttpApiEndpoint.get(
      "list",
      "/api/android-application-identifiers/:applicationIdentifierId/build-credentials",
      {
        params: { ...applicationIdentifierIdParam },
        success: Schema.Struct({ items: Schema.Array(AndroidBuildCredentials) }),
        error: [NotFound, Conflict, BadRequest, Forbidden],
      },
    ).annotateMerge(
      OpenApi.annotations({
        title: "List Android build credentials",
        description: "List named build credential groups for an Android app identifier",
      }),
    ),
    HttpApiEndpoint.post(
      "create",
      "/api/android-application-identifiers/:applicationIdentifierId/build-credentials",
      {
        params: { ...applicationIdentifierIdParam },
        payload: CreateAndroidBuildCredentialsBody,
        success: AndroidBuildCredentials.pipe(HttpApiSchema.status(201)),
        error: [NotFound, Conflict, BadRequest, Forbidden],
      },
    ).annotateMerge(
      OpenApi.annotations({
        title: "Create Android build credentials group",
        description: "Create a named build credentials group (Default or custom)",
      }),
    ),
    HttpApiEndpoint.put("update", "/api/android-build-credentials/:id", {
      params: { ...idParam },
      payload: UpdateAndroidBuildCredentialsBody,
      success: AndroidBuildCredentials,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Update Android build credentials",
        description: "Rename group, change default flag, or swap bound keystore/keys",
      }),
    ),
    HttpApiEndpoint.make("DELETE")("delete", "/api/android-build-credentials/:id", {
      params: { ...idParam },
      success: DeleteAndroidBuildCredentialsResult,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Delete Android build credentials",
        description: "Remove a build credentials group",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Android Build Credentials",
      description: "Named groups of build credentials per Android application identifier",
    }),
  );
