import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import {
  ApplePayCertificate,
  DeleteApplePayCertificateResult,
  DownloadApplePayCertificateResult,
  UploadApplePayCertificateBody,
} from "../domain/apple-pay-certificate";
import { idParam } from "../domain/common";
import { BadRequest, Conflict } from "../domain/errors";

export class ApplePayCertificatesGroup extends HttpApiGroup.make("applePayCertificates")
  .add(
    HttpApiEndpoint.get("list", "/api/apple/pay-certificates")
      .addSuccess(Schema.Struct({ items: Schema.Array(ApplePayCertificate) }))
      .annotateContext(
        OpenApi.annotations({
          title: "List Apple Pay certificates",
          description: "List Apple Pay payment processing certificates for the organization",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("upload", "/api/apple/pay-certificates")
      .setPayload(UploadApplePayCertificateBody)
      .addSuccess(ApplePayCertificate, { status: 201 })
      .annotateContext(
        OpenApi.annotations({
          title: "Upload Apple Pay certificate",
          description: "Upload an Apple Pay payment processing .p12 certificate",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("delete")`/api/apple/pay-certificates/${idParam}`
      .addSuccess(DeleteApplePayCertificateResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Delete Apple Pay certificate",
          description: "Remove a stored Apple Pay payment processing certificate",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("download")`/api/apple/pay-certificates/${idParam}/download`
      .addSuccess(DownloadApplePayCertificateResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Download Apple Pay certificate",
          description:
            "Fetch the decrypted .p12 Apple Pay certificate for local use (audit-logged)",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.put("protect")`/api/apple/pay-certificates/${idParam}/protection`
      .addSuccess(ApplePayCertificate)
      .annotateContext(
        OpenApi.annotations({
          title: "Protect credential",
          description:
            "Mark the Apple Pay certificate protected (GITLAB-RBAC-SPEC §3b): reads/uses require Maintainer+. Org admin only. Idempotent.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("unprotect")`/api/apple/pay-certificates/${idParam}/protection`
      .addSuccess(ApplePayCertificate)
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
      title: "Apple Pay Certificates",
      description: "Manage Apple Pay payment processing certificates",
    }),
  ) {}
