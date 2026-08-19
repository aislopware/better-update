import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import {
  ApplePushKey,
  DeleteApplePushKeyResult,
  DownloadApplePushKeyResult,
  UploadApplePushKeyBody,
} from "../domain/apple-push-key";
import { idParam } from "../domain/common";
import { BadRequest, Conflict } from "../domain/errors";

export const ApplePushKeysGroup = HttpApiGroup.make("applePushKeys")
  .add(
    HttpApiEndpoint.get("list", "/api/apple/push-keys", {
      success: Schema.Struct({ items: Schema.Array(ApplePushKey) }),
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "List Apple push keys",
        description: "List APNs push keys for the organization",
      }),
    ),
    HttpApiEndpoint.post("upload", "/api/apple/push-keys", {
      payload: UploadApplePushKeyBody,
      success: ApplePushKey.pipe(HttpApiSchema.status(201)),
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Upload push key",
        description: "Upload an APNs .p8 push notification key",
      }),
    ),
    HttpApiEndpoint.make("DELETE")("delete", "/api/apple/push-keys/:id", {
      params: { ...idParam },
      success: DeleteApplePushKeyResult,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Delete push key",
        description: "Remove a stored APNs push key",
      }),
    ),
    HttpApiEndpoint.get("download", "/api/apple/push-keys/:id/download", {
      params: { ...idParam },
      success: DownloadApplePushKeyResult,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Download push key",
        description: "Fetch the decrypted .p8 push key for local use (audit-logged)",
      }),
    ),
    HttpApiEndpoint.put("protect", "/api/apple/push-keys/:id/protection", {
      params: { ...idParam },
      success: ApplePushKey,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Protect credential",
        description:
          "Mark the push key protected (GITLAB-RBAC-SPEC §3b): reads/uses require Maintainer+. Org admin only. Idempotent.",
      }),
    ),
    HttpApiEndpoint.make("DELETE")("unprotect", "/api/apple/push-keys/:id/protection", {
      params: { ...idParam },
      success: ApplePushKey,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Unprotect credential",
        description: "Remove the key's protection. Org admin only. Idempotent.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Apple Push Keys",
      description: "Manage APNs push notification keys",
    }),
  );
