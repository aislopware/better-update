import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import {
  Branch,
  CreateBranchBody,
  DeleteBranchResult,
  ListBranchesParams,
  UpdateBranchBody,
} from "../domain/branch";
import { Conflict } from "../domain/errors";

const idParam = HttpApiSchema.param("id", Schema.String);

export class BranchesGroup extends HttpApiGroup.make("branches")
  .add(
    HttpApiEndpoint.post("create", "/api/branches")
      .setPayload(CreateBranchBody)
      .addSuccess(Branch, { status: 201 })
      .annotateContext(
        OpenApi.annotations({
          title: "Create branch",
          description: "Create a new branch within a project",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("list", "/api/branches")
      .setUrlParams(ListBranchesParams)
      .addSuccess(
        Schema.Struct({
          items: Schema.Array(Branch),
          total: Schema.Number,
          page: Schema.Number,
          limit: Schema.Number,
        }),
      )
      .annotateContext(
        OpenApi.annotations({
          title: "List branches",
          description: "List all branches for a project",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.patch("rename")`/api/branches/${idParam}`
      .setPayload(UpdateBranchBody)
      .addSuccess(Branch)
      .addError(Conflict)
      .annotateContext(
        OpenApi.annotations({
          title: "Rename branch",
          description: "Rename a branch (channels and updates are unaffected)",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("delete")`/api/branches/${idParam}`
      .addSuccess(DeleteBranchResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Delete branch",
          description: "Delete a branch and all its updates",
        }),
      ),
  )
  .addError(NotFound)
  .addError(Conflict)
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "Branches",
      description: "Branch management endpoints",
    }),
  ) {}
