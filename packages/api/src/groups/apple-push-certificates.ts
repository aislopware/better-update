import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";
import { Schema } from "effect";

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

export class ApplePushCertificatesGroup extends HttpApiGroup.make("applePushCertificates")
  .add(
    HttpApiEndpoint.get("list", "/api/apple/push-certificates")
      .addSuccess(Schema.Struct({ items: Schema.Array(ApplePushCertificate) }))
      .annotateContext(
        OpenApi.annotations({
          title: "List Apple push certificates",
          description: "List APNs push SSL certificates for the organization",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("upload", "/api/apple/push-certificates")
      .setPayload(UploadApplePushCertificateBody)
      .addSuccess(ApplePushCertificate, { status: 201 })
      .annotateContext(
        OpenApi.annotations({
          title: "Upload push certificate",
          description: "Upload an APNs Push Services .p12 SSL certificate",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("delete")`/api/apple/push-certificates/${idParam}`
      .addSuccess(DeleteApplePushCertificateResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Delete push certificate",
          description: "Remove a stored APNs push SSL certificate",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("download")`/api/apple/push-certificates/${idParam}/download`
      .addSuccess(DownloadApplePushCertificateResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Download push certificate",
          description: "Fetch the decrypted .p12 push certificate for local use (audit-logged)",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.put("protect")`/api/apple/push-certificates/${idParam}/protection`
      .addSuccess(ApplePushCertificate)
      .annotateContext(
        OpenApi.annotations({
          title: "Protect credential",
          description:
            "Mark the push certificate protected (GITLAB-RBAC-SPEC §3b): reads/uses require Maintainer+. Org admin only. Idempotent.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("unprotect")`/api/apple/push-certificates/${idParam}/protection`
      .addSuccess(ApplePushCertificate)
      .annotateContext(
        OpenApi.annotations({
          title: "Unprotect credential",
          description: "Remove the certificate's protection. Org admin only. Idempotent.",
        }),
      ),
  )
  .addError(NotFound)
  .addError(Conflict)
  .addError(BadRequest)
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "Apple Push Certificates",
      description: "Manage APNs Push Services SSL certificates",
    }),
  ) {}
