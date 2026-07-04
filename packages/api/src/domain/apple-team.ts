import { Schema } from "effect";

import { DateTimeString, Id } from "./common";
import { boundProjectIdsField } from "./credential-binding";

export const AppleTeamType = Schema.Literal("IN_HOUSE", "COMPANY_ORGANIZATION", "INDIVIDUAL");
export type AppleTeamTypeValue = typeof AppleTeamType.Type;

/** Apple portal IDs (team, push key, ASC API key) are 10 uppercase alphanumeric chars. */
export const tenCharPortalId = (label: string) =>
  Schema.String.pipe(
    Schema.pattern(/^[A-Z0-9]{10}$/u, {
      message: () => `${label} must be 10 uppercase alphanumeric characters`,
    }),
  );

export const AppleTeamIdentifier = tenCharPortalId("Apple Team identifier");

/** Optional Apple-team metadata carried on credential upload bodies. */
export const appleTeamMetadataFields = {
  appleTeamName: Schema.optional(Schema.String.pipe(Schema.maxLength(200))),
  appleTeamType: Schema.optional(AppleTeamType),
} as const;

export class AppleTeam extends Schema.Class<AppleTeam>("AppleTeam")({
  ...boundProjectIdsField,
  id: Id,
  organizationId: Id,
  appleTeamId: Schema.String,
  appleTeamType: AppleTeamType,
  name: Schema.NullOr(Schema.String),
  /**
   * Protected-team flag (GITLAB-RBAC-SPEC §3b): team-level interactions
   * (creating credentials under the team, devices) require Maintainer+ when
   * set, and new child rows snapshot it as their own initial flag. It does
   * NOT gate existing child credentials — those carry their own toggle.
   */
  protected: Schema.Boolean,
  distributionCertificateCount: Schema.Number,
  pushKeyCount: Schema.Number,
  ascApiKeyCount: Schema.Number,
  provisioningProfileCount: Schema.Number,
  deviceCount: Schema.Number,
  createdAt: DateTimeString,
  updatedAt: DateTimeString,
}) {}
