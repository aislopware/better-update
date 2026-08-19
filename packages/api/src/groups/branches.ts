import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import {
  Branch,
  CreateBranchBody,
  DeleteBranchResult,
  ListBranchesParams,
  UpdateBranchBody,
} from "../domain/branch";
import { idParam, pageResult } from "../domain/common";
import { Conflict } from "../domain/errors";

export const BranchesGroup = HttpApiGroup.make("branches")
  .add(
    HttpApiEndpoint.post("create", "/api/branches", {
      payload: CreateBranchBody,
      success: Branch.pipe(HttpApiSchema.status(201)),
      error: [NotFound, Conflict, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Create branch",
        description: "Create a new branch within a project",
      }),
    ),
    HttpApiEndpoint.get("list", "/api/branches", {
      query: ListBranchesParams,
      success: pageResult(Branch),
      error: [NotFound, Conflict, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "List branches",
        description: "List all branches for a project",
      }),
    ),
    HttpApiEndpoint.get("get", "/api/branches/:id", {
      params: { ...idParam },
      success: Branch,
      error: [NotFound, Conflict, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Get branch",
        description: "Fetch a single branch by ID",
      }),
    ),
    HttpApiEndpoint.patch("rename", "/api/branches/:id", {
      params: { ...idParam },
      payload: UpdateBranchBody,
      success: Branch,
      error: [Conflict, NotFound, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Rename branch",
        description: "Rename a branch (channels and updates are unaffected)",
      }),
    ),
    HttpApiEndpoint.make("DELETE")("delete", "/api/branches/:id", {
      params: { ...idParam },
      success: DeleteBranchResult,
      error: [NotFound, Conflict, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Delete branch",
        description: "Delete a branch and all its updates",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Branches",
      description: "Branch management endpoints",
    }),
  );
