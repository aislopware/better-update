import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import {
  AppleDistributionCertificate,
  DeleteAppleDistributionCertificateResult,
  DownloadAppleDistributionCertificateResult,
  UploadAppleDistributionCertificateBody,
} from "../domain/apple-distribution-certificate";
import { idParam } from "../domain/common";
import { BadRequest, Conflict } from "../domain/errors";

export const AppleDistributionCertificatesGroup = HttpApiGroup.make("appleDistributionCertificates")
  .add(
    HttpApiEndpoint.get("list", "/api/apple/distribution-certificates", {
      success: Schema.Struct({ items: Schema.Array(AppleDistributionCertificate) }),
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "List Apple distribution certificates",
        description: "List uploaded Apple distribution certificates for the organization",
      }),
    ),
    HttpApiEndpoint.post("upload", "/api/apple/distribution-certificates", {
      payload: UploadAppleDistributionCertificateBody,
      success: AppleDistributionCertificate.pipe(HttpApiSchema.status(201)),
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Upload distribution certificate",
        description:
          "Upload a .p12 distribution certificate; auto-derives the Apple team from the provided identifier",
      }),
    ),
    HttpApiEndpoint.make("DELETE")("delete", "/api/apple/distribution-certificates/:id", {
      params: { ...idParam },
      success: DeleteAppleDistributionCertificateResult,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Delete distribution certificate",
        description: "Remove a distribution certificate from storage",
      }),
    ),
    HttpApiEndpoint.get("download", "/api/apple/distribution-certificates/:id/download", {
      params: { ...idParam },
      success: DownloadAppleDistributionCertificateResult,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Download distribution certificate",
        description: "Fetch the decrypted .p12 + password for local use (audit-logged)",
      }),
    ),
    HttpApiEndpoint.put("protect", "/api/apple/distribution-certificates/:id/protection", {
      params: { ...idParam },
      success: AppleDistributionCertificate,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Protect credential",
        description:
          "Mark the certificate protected (GITLAB-RBAC-SPEC §3b): reads/uses require Maintainer+. Org admin only. Idempotent.",
      }),
    ),
    HttpApiEndpoint.make("DELETE")(
      "unprotect",
      "/api/apple/distribution-certificates/:id/protection",
      {
        params: { ...idParam },
        success: AppleDistributionCertificate,
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
      title: "Apple Distribution Certificates",
      description: "Manage .p12 distribution certificates",
    }),
  );
