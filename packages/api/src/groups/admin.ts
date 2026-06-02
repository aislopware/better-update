import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { AdminUser, ListAdminUsersParams } from "../domain/admin";
import { pageResult } from "../domain/common";

const userIdParam = HttpApiSchema.param("userId", Schema.String);

/**
 * Platform administration, restricted to superadmins (Better Auth admin-plugin
 * `role = "admin"`). The dev-phase approval gate lives here: superadmins list
 * users and approve/revoke their access. All endpoints fail `Forbidden` for
 * non-superadmins.
 */
export class AdminGroup extends HttpApiGroup.make("admin")
  .add(
    HttpApiEndpoint.get("listUsers", "/api/admin/users")
      .setUrlParams(ListAdminUsersParams)
      .addSuccess(pageResult(AdminUser))
      .annotateContext(
        OpenApi.annotations({
          title: "List users",
          description: "List platform users with approval status (superadmin only)",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("approveUser")`/api/admin/users/${userIdParam}/approve`
      .addSuccess(AdminUser)
      .annotateContext(
        OpenApi.annotations({
          title: "Approve user",
          description: "Grant a user access to the app (superadmin only)",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("revokeUser")`/api/admin/users/${userIdParam}/revoke`
      .addSuccess(AdminUser)
      .annotateContext(
        OpenApi.annotations({
          title: "Revoke user approval",
          description: "Revoke a user's access to the app (superadmin only)",
        }),
      ),
  )
  .addError(Forbidden)
  .addError(NotFound)
  .annotateContext(
    OpenApi.annotations({
      title: "Admin",
      description: "Superadmin platform administration",
    }),
  ) {}
