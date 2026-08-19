import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { AdminUser, ListAdminUsersParams } from "../domain/admin";
import { pageResult } from "../domain/common";

const userIdParam = { userId: Schema.String };

/**
 * Platform administration, restricted to superadmins (Better Auth admin-plugin
 * `role = "admin"`). The dev-phase approval gate lives here: superadmins list
 * users and approve/revoke their access. All endpoints fail `Forbidden` for
 * non-superadmins.
 */
export const AdminGroup = HttpApiGroup.make("admin")
  .add(
    HttpApiEndpoint.get("listUsers", "/api/admin/users", {
      query: ListAdminUsersParams,
      success: pageResult(AdminUser),
      error: [Forbidden, NotFound],
    }).annotateMerge(
      OpenApi.annotations({
        title: "List users",
        description: "List platform users with approval status (superadmin only)",
      }),
    ),
    HttpApiEndpoint.post("approveUser", "/api/admin/users/:userId/approve", {
      params: { ...userIdParam },
      success: AdminUser,
      error: [Forbidden, NotFound],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Approve user",
        description: "Grant a user access to the app (superadmin only)",
      }),
    ),
    HttpApiEndpoint.post("revokeUser", "/api/admin/users/:userId/revoke", {
      params: { ...userIdParam },
      success: AdminUser,
      error: [Forbidden, NotFound],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Revoke user approval",
        description: "Revoke a user's access to the app (superadmin only)",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Admin",
      description: "Superadmin platform administration",
    }),
  );
