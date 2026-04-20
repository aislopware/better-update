import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import {
  AppleDistributionCertificate,
  DeleteAppleDistributionCertificateResult,
  UploadAppleDistributionCertificateBody,
} from "../domain/apple-distribution-certificate";
import { BadRequest, Conflict } from "../domain/errors";

const idParam = HttpApiSchema.param("id", Schema.String);

export class AppleDistributionCertificatesGroup extends HttpApiGroup.make(
  "appleDistributionCertificates",
)
  .add(
    HttpApiEndpoint.get("list", "/api/apple/distribution-certificates")
      .addSuccess(Schema.Struct({ items: Schema.Array(AppleDistributionCertificate) }))
      .annotateContext(
        OpenApi.annotations({
          title: "List Apple distribution certificates",
          description: "List uploaded Apple distribution certificates for the organization",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("upload", "/api/apple/distribution-certificates")
      .setPayload(UploadAppleDistributionCertificateBody)
      .addSuccess(AppleDistributionCertificate, { status: 201 })
      .annotateContext(
        OpenApi.annotations({
          title: "Upload distribution certificate",
          description:
            "Upload a .p12 distribution certificate; auto-derives the Apple team from the provided identifier",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("delete")`/api/apple/distribution-certificates/${idParam}`
      .addSuccess(DeleteAppleDistributionCertificateResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Delete distribution certificate",
          description: "Remove a distribution certificate from storage",
        }),
      ),
  )
  .addError(NotFound)
  .addError(Conflict)
  .addError(BadRequest)
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "Apple Distribution Certificates",
      description: "Manage .p12 distribution certificates",
    }),
  ) {}
