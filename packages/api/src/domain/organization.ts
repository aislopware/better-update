import { Schema } from "effect";

import { Id } from "./common";

// The active organization, as surfaced by the IAM-gated settings endpoint.
export class Organization extends Schema.Class<Organization>("Organization")({
  id: Id,
  name: Schema.String,
  slug: Schema.String,
}) {}

// PATCH body for org settings — both fields optional (only provided ones change).
// Targets the ACTIVE org (resolved from the session), so there is no id path param
// and no cross-org reach. `slug` is unique org-wide (the endpoint maps a collision
// to Conflict).
export const UpdateOrganizationBody = Schema.Struct({
  name: Schema.optional(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(120))),
  slug: Schema.optional(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(120))),
});
