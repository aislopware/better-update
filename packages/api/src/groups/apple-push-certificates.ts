import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import {
  ApplePushCertificate,
  DeleteApplePushCertificateResult,
  DownloadApplePushCertificateResult,
  UploadApplePushCertificateBody,
} from "../domain/apple-push-certificate";
import { idParam } from "../domain/common";
import { BadRequest, Conflict } from "../domain/errors";

export const ApplePushCertificatesGroup = HttpApiGroup.make("applePushCertificates")
  .add(
    HttpApiEndpoint.get("list", "/api/apple/push-certificates", {
      success: Schema.Struct({ items: Schema.Array(ApplePushCertificate) }),
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "List Apple push certificates",
        description: "List APNs push SSL certificates for the organization",
      }),
    ),
    HttpApiEndpoint.post("upload", "/api/apple/push-certificates", {
      payload: UploadApplePushCertificateBody,
      success: ApplePushCertificate.pipe(HttpApiSchema.status(201)),
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Upload push certificate",
        description: "Upload an APNs Push Services .p12 SSL certificate",
      }),
    ),
    HttpApiEndpoint.make("DELETE")("delete", "/api/apple/push-certificates/:id", {
      params: { ...idParam },
      success: DeleteApplePushCertificateResult,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Delete push certificate",
        description: "Remove a stored APNs push SSL certificate",
      }),
    ),
    HttpApiEndpoint.get("download", "/api/apple/push-certificates/:id/download", {
      params: { ...idParam },
      success: DownloadApplePushCertificateResult,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Download push certificate",
        description: "Fetch the decrypted .p12 push certificate for local use (audit-logged)",
      }),
    ),
    HttpApiEndpoint.put("protect", "/api/apple/push-certificates/:id/protection", {
      params: { ...idParam },
      success: ApplePushCertificate,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Protect credential",
        description:
          "Mark the push certificate protected (GITLAB-RBAC-SPEC §3b): reads/uses require Maintainer+. Org admin only. Idempotent.",
      }),
    ),
    HttpApiEndpoint.make("DELETE")("unprotect", "/api/apple/push-certificates/:id/protection", {
      params: { ...idParam },
      success: ApplePushCertificate,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Unprotect credential",
        description: "Remove the certificate's protection. Org admin only. Idempotent.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Apple Push Certificates",
      description: "Manage APNs Push Services SSL certificates",
    }),
  );
