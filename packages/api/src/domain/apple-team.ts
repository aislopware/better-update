import { Schema } from "effect";

import { DateTimeString, Id } from "./common";

export const AppleTeamType = Schema.Literal("IN_HOUSE", "COMPANY_ORGANIZATION", "INDIVIDUAL");
export type AppleTeamTypeValue = typeof AppleTeamType.Type;

export const AppleTeamIdentifier = Schema.String.pipe(
  Schema.pattern(/^[A-Z0-9]{10}$/u, {
    message: () => "Apple Team identifier must be 10 uppercase alphanumeric characters",
  }),
);

export class AppleTeam extends Schema.Class<AppleTeam>("AppleTeam")({
  id: Id,
  organizationId: Id,
  appleTeamId: Schema.String,
  appleTeamType: AppleTeamType,
  name: Schema.NullOr(Schema.String),
  distributionCertificateCount: Schema.Number,
  pushKeyCount: Schema.Number,
  ascApiKeyCount: Schema.Number,
  provisioningProfileCount: Schema.Number,
  deviceCount: Schema.Number,
  createdAt: DateTimeString,
  updatedAt: DateTimeString,
}) {}
