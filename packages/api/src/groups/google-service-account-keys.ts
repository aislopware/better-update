import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { idParam } from "../domain/common";
import { BadRequest, Conflict } from "../domain/errors";
import {
  DeleteGoogleServiceAccountKeyResult,
  DownloadGoogleServiceAccountKeyResult,
  GoogleServiceAccountKey,
  UploadGoogleServiceAccountKeyBody,
} from "../domain/google-service-account-key";

export const GoogleServiceAccountKeysGroup = HttpApiGroup.make("googleServiceAccountKeys")
  .add(
    HttpApiEndpoint.get("list", "/api/google/service-account-keys", {
      success: Schema.Struct({ items: Schema.Array(GoogleServiceAccountKey) }),
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "List Google service account keys",
        description: "List uploaded Google service account JSON keys",
      }),
    ),
    HttpApiEndpoint.post("upload", "/api/google/service-account-keys", {
      payload: UploadGoogleServiceAccountKeyBody,
      success: GoogleServiceAccountKey.pipe(HttpApiSchema.status(201)),
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Upload service account key",
        description: "Upload a Google service account JSON key",
      }),
    ),
    HttpApiEndpoint.make("DELETE")("delete", "/api/google/service-account-keys/:id", {
      params: { ...idParam },
      success: DeleteGoogleServiceAccountKeyResult,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Delete service account key",
        description: "Remove a stored Google service account key",
      }),
    ),
    HttpApiEndpoint.get("download", "/api/google/service-account-keys/:id/download", {
      params: { ...idParam },
      success: DownloadGoogleServiceAccountKeyResult,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Download service account key",
        description: "Fetch the decrypted JSON for local use (audit-logged)",
      }),
    ),
    HttpApiEndpoint.put("protect", "/api/google/service-account-keys/:id/protection", {
      params: { ...idParam },
      success: GoogleServiceAccountKey,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Protect credential",
        description:
          "Mark the credential protected (GITLAB-RBAC-SPEC §3b): reads/uses require Maintainer+. Org admin only. Idempotent.",
      }),
    ),
    HttpApiEndpoint.make("DELETE")("unprotect", "/api/google/service-account-keys/:id/protection", {
      params: { ...idParam },
      success: GoogleServiceAccountKey,
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
      title: "Google Service Account Keys",
      description: "Manage Google Play + FCM service account JSON keys",
    }),
  );
