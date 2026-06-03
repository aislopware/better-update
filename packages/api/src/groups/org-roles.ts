import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { idParam } from "../domain/common";
import { Conflict } from "../domain/errors";
import {
  CreateOrgRoleBody,
  DeleteOrgRoleResult,
  ListOrgRolesParams,
  OrgRole,
  UpdateOrgRoleBody,
} from "../domain/org-role";

export class OrgRolesGroup extends HttpApiGroup.make("roles")
  .add(
    HttpApiEndpoint.get("list", "/api/roles")
      .setUrlParams(ListOrgRolesParams)
      .addSuccess(Schema.Array(OrgRole))
      .annotateContext(
        OpenApi.annotations({
          title: "List custom roles",
          description: "List all custom roles defined for an organization",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("create", "/api/roles")
      .setPayload(CreateOrgRoleBody)
      .addSuccess(OrgRole, { status: 201 })
      .annotateContext(
        OpenApi.annotations({
          title: "Create custom role",
          description: "Create a new custom role with a permission set",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("get")`/api/roles/${idParam}`.addSuccess(OrgRole).annotateContext(
      OpenApi.annotations({
        title: "Get custom role",
        description: "Fetch a single custom role by id",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.patch("update")`/api/roles/${idParam}`
      .setPayload(UpdateOrgRoleBody)
      .addSuccess(OrgRole)
      .annotateContext(
        OpenApi.annotations({
          title: "Update custom role",
          description: "Rename a custom role or replace its permission set",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("delete")`/api/roles/${idParam}`
      .addSuccess(DeleteOrgRoleResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Delete custom role",
          description: "Delete a custom role",
        }),
      ),
  )
  .addError(NotFound)
  .addError(Conflict)
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "Roles",
      description: "Custom organization role management (dynamic access control)",
    }),
  ) {}
