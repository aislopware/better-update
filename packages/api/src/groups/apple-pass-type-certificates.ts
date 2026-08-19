import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

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

export const ApplePassTypeCertificatesGroup = HttpApiGroup.make("applePassTypeCertificates")
  .add(
    HttpApiEndpoint.get("list", "/api/apple/pass-type-certificates", {
      success: Schema.Struct({ items: Schema.Array(ApplePassTypeCertificate) }),
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "List Apple Pass Type ID certificates",
        description: "List Pass Type ID certificates for the organization",
      }),
    ),
    HttpApiEndpoint.post("upload", "/api/apple/pass-type-certificates", {
      payload: UploadApplePassTypeCertificateBody,
      success: ApplePassTypeCertificate.pipe(HttpApiSchema.status(201)),
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Upload Pass Type ID certificate",
        description: "Upload a Wallet Pass Type ID .p12 certificate",
      }),
    ),
    HttpApiEndpoint.make("DELETE")("delete", "/api/apple/pass-type-certificates/:id", {
      params: { ...idParam },
      success: DeleteApplePassTypeCertificateResult,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Delete Pass Type ID certificate",
        description: "Remove a stored Pass Type ID certificate",
      }),
    ),
    HttpApiEndpoint.get("download", "/api/apple/pass-type-certificates/:id/download", {
      params: { ...idParam },
      success: DownloadApplePassTypeCertificateResult,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Download Pass Type ID certificate",
        description:
          "Fetch the decrypted .p12 Pass Type ID certificate for local use (audit-logged)",
      }),
    ),
    HttpApiEndpoint.put("protect", "/api/apple/pass-type-certificates/:id/protection", {
      params: { ...idParam },
      success: ApplePassTypeCertificate,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Protect credential",
        description:
          "Mark the Pass Type ID certificate protected (GITLAB-RBAC-SPEC §3b): reads/uses require Maintainer+. Org admin only. Idempotent.",
      }),
    ),
    HttpApiEndpoint.make("DELETE")(
      "unprotect",
      "/api/apple/pass-type-certificates/:id/protection",
      {
        params: { ...idParam },
        success: ApplePassTypeCertificate,
        error: [NotFound, Conflict, BadRequest, Forbidden],
      },
    ).annotateMerge(
      OpenApi.annotations({
        title: "Unprotect credential",
        description: "Remove the certificate's protection. Org admin only. Idempotent.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Apple Pass Type ID Certificates",
      description: "Manage Wallet Pass Type ID certificates",
    }),
  );
