import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import {
  ApplePassTypeCertificate,
  DeleteApplePassTypeCertificateResult,
  DownloadApplePassTypeCertificateResult,
  UploadApplePassTypeCertificateBody,
} from "../domain/apple-pass-type-certificate";
import { idParam } from "../domain/common";
import { BadRequest, Conflict } from "../domain/errors";

export class ApplePassTypeCertificatesGroup extends HttpApiGroup.make("applePassTypeCertificates")
  .add(
    HttpApiEndpoint.get("list", "/api/apple/pass-type-certificates")
      .addSuccess(Schema.Struct({ items: Schema.Array(ApplePassTypeCertificate) }))
      .annotateContext(
        OpenApi.annotations({
          title: "List Apple Pass Type ID certificates",
          description: "List Pass Type ID certificates for the organization",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("upload", "/api/apple/pass-type-certificates")
      .setPayload(UploadApplePassTypeCertificateBody)
      .addSuccess(ApplePassTypeCertificate, { status: 201 })
      .annotateContext(
        OpenApi.annotations({
          title: "Upload Pass Type ID certificate",
          description: "Upload a Wallet Pass Type ID .p12 certificate",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("delete")`/api/apple/pass-type-certificates/${idParam}`
      .addSuccess(DeleteApplePassTypeCertificateResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Delete Pass Type ID certificate",
          description: "Remove a stored Pass Type ID certificate",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("download")`/api/apple/pass-type-certificates/${idParam}/download`
      .addSuccess(DownloadApplePassTypeCertificateResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Download Pass Type ID certificate",
          description:
            "Fetch the decrypted .p12 Pass Type ID certificate for local use (audit-logged)",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.put("protect")`/api/apple/pass-type-certificates/${idParam}/protection`
      .addSuccess(ApplePassTypeCertificate)
      .annotateContext(
        OpenApi.annotations({
          title: "Protect credential",
          description:
            "Mark the Pass Type ID certificate protected (GITLAB-RBAC-SPEC §3b): reads/uses require Maintainer+. Org admin only. Idempotent.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("unprotect")`/api/apple/pass-type-certificates/${idParam}/protection`
      .addSuccess(ApplePassTypeCertificate)
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
      title: "Apple Pass Type ID Certificates",
      description: "Manage Wallet Pass Type ID certificates",
    }),
  ) {}
