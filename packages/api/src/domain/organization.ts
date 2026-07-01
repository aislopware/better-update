import { Schema } from "effect";

import { DateTimeString, Id, UploadHeaders } from "./common";

// The active organization, as surfaced by the IAM-gated settings endpoint.
export class Organization extends Schema.Class<Organization>("Organization")({
  id: Id,
  name: Schema.String,
  slug: Schema.String,
  /** Absolute public CDN URL of the organization logo; `null` when none is set. */
  logoUrl: Schema.NullOr(Schema.String),
}) {}

// PATCH body for org settings — both fields optional (only provided ones change).
// Targets the ACTIVE org (resolved from the session), so there is no id path param
// and no cross-org reach. `slug` is unique org-wide (the endpoint maps a collision
// to Conflict).
export const UpdateOrganizationBody = Schema.Struct({
  name: Schema.optional(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(120))),
  slug: Schema.optional(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(120))),
});

/** Image MIME types accepted for an organization logo. */
export const OrganizationLogoContentType = Schema.Literal(
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
);

/**
 * Request a presigned PUT to upload the active organization's logo. The server
 * builds the R2 key itself (`logos/org/{organizationId}`) — never trusting a
 * client-sent key — and signs the content type into the URL, so the direct
 * upload must send the returned headers.
 */
export const OrganizationLogoUploadBody = Schema.Struct({
  contentType: OrganizationLogoContentType,
});

export const OrganizationLogoUploadResult = Schema.Struct({
  /** R2 object key the presigned URL targets (`logos/org/{organizationId}`). */
  key: Schema.String,
  uploadUrl: Schema.String,
  uploadExpiresAt: DateTimeString,
  uploadHeaders: UploadHeaders,
});
