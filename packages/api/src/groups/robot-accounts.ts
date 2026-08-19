import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { DeletedResult, idParam } from "../domain/common";
import { Conflict } from "../domain/errors";
import {
  CreateRobotAccountBody,
  CreatedRobotAccount,
  ListRobotAccountsParams,
  RobotAccount,
  RobotAccountList,
  RotatedRobotAccountBearer,
  UpdateRobotAccountBody,
} from "../domain/robot-account";

export const RobotAccountsGroup = HttpApiGroup.make("robot-accounts")
  .add(
    HttpApiEndpoint.get("list", "/api/robot-accounts", {
      query: ListRobotAccountsParams,
      success: RobotAccountList,
      error: [NotFound, Conflict, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "List robot accounts",
        description:
          "List the active organization's robot accounts (hashed bearer secret never exposed; only `bearerStart` for identification)",
      }),
    ),
    HttpApiEndpoint.post("create", "/api/robot-accounts", {
      payload: CreateRobotAccountBody,
      success: CreatedRobotAccount.pipe(HttpApiSchema.status(201)),
      error: [NotFound, Conflict, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Create robot account",
        description:
          "Mint a new org-owned robot account: registers the given vault public key as a machine recipient and mints a bearer secret. Both secrets are returned ONCE",
      }),
    ),
    HttpApiEndpoint.patch("update", "/api/robot-accounts/:id", {
      params: { ...idParam },
      payload: UpdateRobotAccountBody,
      success: RobotAccount,
      error: [NotFound, Conflict, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Update robot account",
        description:
          "Rename a robot account and/or change its project role in place (the project itself is fixed at creation). Every change is audit-logged",
      }),
    ),
    HttpApiEndpoint.post("rotate", "/api/robot-accounts/:id/rotate", {
      params: { ...idParam },
      success: RotatedRobotAccountBearer,
      error: [NotFound, Conflict, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Rotate robot account bearer",
        description:
          "Re-mint a robot account's bearer secret; any linked vault identity is left untouched",
      }),
    ),
    HttpApiEndpoint.make("DELETE")("revoke", "/api/robot-accounts/:id", {
      params: { ...idParam },
      success: DeletedResult,
      error: [NotFound, Conflict, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Revoke robot account",
        description:
          "Delete a robot account by id (org-scoped; no cross-organization deletes). Any linked vault identity's own recipient row is untouched — revoke its vault access separately",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Robot Accounts",
      description: "IAM-gated org-owned CI robot account mint / list / rotate / revoke",
    }),
  );
