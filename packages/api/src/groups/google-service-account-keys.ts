import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";
import { Schema } from "effect";

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

export class GoogleServiceAccountKeysGroup extends HttpApiGroup.make("googleServiceAccountKeys")
  .add(
    HttpApiEndpoint.get("list", "/api/google/service-account-keys")
      .addSuccess(Schema.Struct({ items: Schema.Array(GoogleServiceAccountKey) }))
      .annotateContext(
        OpenApi.annotations({
          title: "List Google service account keys",
          description: "List uploaded Google service account JSON keys",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("upload", "/api/google/service-account-keys")
      .setPayload(UploadGoogleServiceAccountKeyBody)
      .addSuccess(GoogleServiceAccountKey, { status: 201 })
      .annotateContext(
        OpenApi.annotations({
          title: "Upload service account key",
          description: "Upload a Google service account JSON key",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("delete")`/api/google/service-account-keys/${idParam}`
      .addSuccess(DeleteGoogleServiceAccountKeyResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Delete service account key",
          description: "Remove a stored Google service account key",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("download")`/api/google/service-account-keys/${idParam}/download`
      .addSuccess(DownloadGoogleServiceAccountKeyResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Download service account key",
          description: "Fetch the decrypted JSON for local use (audit-logged)",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.put("protect")`/api/google/service-account-keys/${idParam}/protection`
      .addSuccess(GoogleServiceAccountKey)
      .annotateContext(
        OpenApi.annotations({
          title: "Protect credential",
          description:
            "Mark the credential protected (GITLAB-RBAC-SPEC §3b): reads/uses require Maintainer+. Org admin only. Idempotent.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("unprotect")`/api/google/service-account-keys/${idParam}/protection`
      .addSuccess(GoogleServiceAccountKey)
      .annotateContext(
        OpenApi.annotations({
          title: "Unprotect credential",
          description: "Remove the credential's protection. Org admin only. Idempotent.",
        }),
      ),
  )
  .addError(NotFound)
  .addError(Conflict)
  .addError(BadRequest)
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "Google Service Account Keys",
      description: "Manage Google Play + FCM service account JSON keys",
    }),
  ) {}
