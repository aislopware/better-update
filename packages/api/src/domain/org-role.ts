import { Schema } from "effect";

import { DateTimeString, Id } from "./common";

/** One resource→actions grant inside a role's permission set. */
export const PermissionGrantSchema = Schema.Struct({
  resource: Schema.String,
  actions: Schema.Array(Schema.String),
});

export class OrgRole extends Schema.Class<OrgRole>("OrgRole")({
  id: Id,
  organizationId: Id,
  role: Schema.String,
  permissions: Schema.Array(PermissionGrantSchema),
  createdAt: DateTimeString,
  updatedAt: Schema.NullOr(DateTimeString),
}) {}

export const CreateOrgRoleBody = Schema.Struct({
  name: Schema.String.pipe(Schema.minLength(1)),
  permissions: Schema.Array(PermissionGrantSchema),
});

export const UpdateOrgRoleBody = Schema.Struct({
  permissions: Schema.optional(Schema.Array(PermissionGrantSchema)),
  name: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
});

export const ListOrgRolesParams = Schema.Struct({
  organizationId: Id,
});

export const DeleteOrgRoleResult = Schema.Struct({ deleted: Schema.Number });
