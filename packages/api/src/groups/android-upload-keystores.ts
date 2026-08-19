import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import {
  AndroidUploadKeystore,
  DeleteAndroidUploadKeystoreResult,
  DownloadAndroidUploadKeystoreResult,
  UploadAndroidUploadKeystoreBody,
} from "../domain/android-upload-keystore";
import { idParam } from "../domain/common";
import { BadRequest, Conflict } from "../domain/errors";

export const AndroidUploadKeystoresGroup = HttpApiGroup.make("androidUploadKeystores")
  .add(
    HttpApiEndpoint.get("list", "/api/android/upload-keystores", {
      success: Schema.Struct({ items: Schema.Array(AndroidUploadKeystore) }),
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "List Android upload keystores",
        description: "List uploaded Android keystores",
      }),
    ),
    HttpApiEndpoint.post("upload", "/api/android/upload-keystores", {
      payload: UploadAndroidUploadKeystoreBody,
      success: AndroidUploadKeystore.pipe(HttpApiSchema.status(201)),
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Upload Android keystore",
        description: "Upload a JKS/PKCS12 keystore with key alias + passwords",
      }),
    ),
    HttpApiEndpoint.make("DELETE")("delete", "/api/android/upload-keystores/:id", {
      params: { ...idParam },
      success: DeleteAndroidUploadKeystoreResult,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Delete Android keystore",
        description: "Remove a stored Android keystore",
      }),
    ),
    HttpApiEndpoint.get("download", "/api/android/upload-keystores/:id/download", {
      params: { ...idParam },
      success: DownloadAndroidUploadKeystoreResult,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Download Android keystore",
        description: "Fetch the decrypted keystore + passwords for local use (audit-logged)",
      }),
    ),
    HttpApiEndpoint.put("protect", "/api/android/upload-keystores/:id/protection", {
      params: { ...idParam },
      success: AndroidUploadKeystore,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Protect credential",
        description:
          "Mark the credential protected (GITLAB-RBAC-SPEC §3b): reads/uses require Maintainer+. Org admin only. Idempotent.",
      }),
    ),
    HttpApiEndpoint.make("DELETE")("unprotect", "/api/android/upload-keystores/:id/protection", {
      params: { ...idParam },
      success: AndroidUploadKeystore,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Unprotect credential",
        description: "Remove the credential's protection. Org admin only. Idempotent.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Android Upload Keystores",
      description: "Manage Android signing keystores",
    }),
  );
