import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";

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
export const OrganizationGroup = HttpApiGroup.make("organization")
  .add(
    HttpApiEndpoint.patch("update", "/api/organization", {
      payload: UpdateOrganizationBody,
      success: Organization,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Update organization",
        description: "Rename / re-slug the active organization (IAM-gated by organization:update)",
      }),
    ),
    HttpApiEndpoint.post("createLogoUploadUrl", "/api/organization/logo/upload-url", {
      payload: OrganizationLogoUploadBody,
      success: OrganizationLogoUploadResult,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Create organization logo upload URL",
        description:
          "Request a presigned PUT URL to upload the active organization's logo directly " +
          "to object storage. Send the returned headers with the upload, then call “Set " +
          "organization logo” to finalize.",
      }),
    ),
    HttpApiEndpoint.put("setLogo", "/api/organization/logo", {
      success: Organization,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Set organization logo",
        description:
          "Finalize the active organization's logo after its bytes were uploaded via the " +
          "presigned URL: validates the stored object and records its public CDN URL.",
      }),
    ),
    HttpApiEndpoint.make("DELETE")("removeLogo", "/api/organization/logo", {
      success: Organization,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Remove organization logo",
        description: "Remove the active organization's logo, clearing it back to the default",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Organization",
      description: "IAM-gated active-organization settings",
    }),
  );
