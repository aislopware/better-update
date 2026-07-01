import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { BadRequest, Conflict } from "../domain/errors";
import {
  Organization,
  OrganizationLogoUploadBody,
  OrganizationLogoUploadResult,
  UpdateOrganizationBody,
} from "../domain/organization";

// IAM-gated active-organization settings. Org CREATE stays on better-auth (a
// pre-org platform/approval gate IAM cannot evaluate); org DELETE stays on
// better-auth too (owner-only; its cross-table cascade is delegated there). Org
// UPDATE is an in-org mutation with full actor context, so it gates here on
// `assertAccess("organization","update")`.
export class OrganizationGroup extends HttpApiGroup.make("organization")
  .add(
    HttpApiEndpoint.patch("update", "/api/organization")
      .setPayload(UpdateOrganizationBody)
      .addSuccess(Organization)
      .annotateContext(
        OpenApi.annotations({
          title: "Update organization",
          description:
            "Rename / re-slug the active organization (IAM-gated by organization:update)",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("createLogoUploadUrl", "/api/organization/logo/upload-url")
      .setPayload(OrganizationLogoUploadBody)
      .addSuccess(OrganizationLogoUploadResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Create organization logo upload URL",
          description:
            "Request a presigned PUT URL to upload the active organization's logo directly " +
            "to object storage. Send the returned headers with the upload, then call “Set " +
            "organization logo” to finalize.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.put("setLogo", "/api/organization/logo")
      .addSuccess(Organization)
      .annotateContext(
        OpenApi.annotations({
          title: "Set organization logo",
          description:
            "Finalize the active organization's logo after its bytes were uploaded via the " +
            "presigned URL: validates the stored object and records its public CDN URL.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("removeLogo", "/api/organization/logo")
      .addSuccess(Organization)
      .annotateContext(
        OpenApi.annotations({
          title: "Remove organization logo",
          description: "Remove the active organization's logo, clearing it back to the default",
        }),
      ),
  )
  .addError(NotFound)
  .addError(Conflict)
  .addError(BadRequest)
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "Organization",
      description: "IAM-gated active-organization settings",
    }),
  ) {}
