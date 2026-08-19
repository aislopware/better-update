import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

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

export const ApplePayCertificatesGroup = HttpApiGroup.make("applePayCertificates")
  .add(
    HttpApiEndpoint.get("list", "/api/apple/pay-certificates", {
      success: Schema.Struct({ items: Schema.Array(ApplePayCertificate) }),
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "List Apple Pay certificates",
        description: "List Apple Pay payment processing certificates for the organization",
      }),
    ),
    HttpApiEndpoint.post("upload", "/api/apple/pay-certificates", {
      payload: UploadApplePayCertificateBody,
      success: ApplePayCertificate.pipe(HttpApiSchema.status(201)),
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Upload Apple Pay certificate",
        description: "Upload an Apple Pay payment processing .p12 certificate",
      }),
    ),
    HttpApiEndpoint.make("DELETE")("delete", "/api/apple/pay-certificates/:id", {
      params: { ...idParam },
      success: DeleteApplePayCertificateResult,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Delete Apple Pay certificate",
        description: "Remove a stored Apple Pay payment processing certificate",
      }),
    ),
    HttpApiEndpoint.get("download", "/api/apple/pay-certificates/:id/download", {
      params: { ...idParam },
      success: DownloadApplePayCertificateResult,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Download Apple Pay certificate",
        description: "Fetch the decrypted .p12 Apple Pay certificate for local use (audit-logged)",
      }),
    ),
    HttpApiEndpoint.put("protect", "/api/apple/pay-certificates/:id/protection", {
      params: { ...idParam },
      success: ApplePayCertificate,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Protect credential",
        description:
          "Mark the Apple Pay certificate protected (GITLAB-RBAC-SPEC §3b): reads/uses require Maintainer+. Org admin only. Idempotent.",
      }),
    ),
    HttpApiEndpoint.make("DELETE")("unprotect", "/api/apple/pay-certificates/:id/protection", {
      params: { ...idParam },
      success: ApplePayCertificate,
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
      title: "Apple Pay Certificates",
      description: "Manage Apple Pay payment processing certificates",
    }),
  );
