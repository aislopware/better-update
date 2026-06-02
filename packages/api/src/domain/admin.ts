import { Schema } from "effect";

import { DateTimeString, PaginationParams } from "./common";

/**
 * A platform user as seen by a superadmin on the dashboard `/admin` page.
 * `role` is the GLOBAL Better Auth admin-plugin role (e.g. "admin"), distinct
 * from per-organization membership roles. `approved` is the dev-phase gate.
 */
export const AdminUser = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  role: Schema.NullOr(Schema.String),
  approved: Schema.Boolean,
  banned: Schema.Boolean,
  createdAt: DateTimeString,
});
export type AdminUser = typeof AdminUser.Type;

export const AdminUserStatus = Schema.Literal("all", "pending", "approved");
export type AdminUserStatus = typeof AdminUserStatus.Type;

export const ListAdminUsersParams = Schema.Struct({
  search: Schema.optional(Schema.String),
  status: Schema.optional(AdminUserStatus),
  ...PaginationParams.fields,
});
