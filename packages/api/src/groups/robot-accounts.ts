import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { DeletedResult, idParam } from "../domain/common";
import { Conflict } from "../domain/errors";
import {
  CreateRobotAccountBody,
  CreatedRobotAccount,
  ListRobotAccountsParams,
  RobotAccountList,
  RotatedRobotAccountBearer,
} from "../domain/robot-account";

export class RobotAccountsGroup extends HttpApiGroup.make("robot-accounts")
  .add(
    HttpApiEndpoint.get("list", "/api/robot-accounts")
      .setUrlParams(ListRobotAccountsParams)
      .addSuccess(RobotAccountList)
      .annotateContext(
        OpenApi.annotations({
          title: "List robot accounts",
          description:
            "List the active organization's robot accounts (hashed bearer secret never exposed; only `bearerStart` for identification)",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("create", "/api/robot-accounts")
      .setPayload(CreateRobotAccountBody)
      .addSuccess(CreatedRobotAccount, { status: 201 })
      .annotateContext(
        OpenApi.annotations({
          title: "Create robot account",
          description:
            "Mint a new org-owned robot account: registers the given vault public key as a machine recipient and mints a bearer secret. Both secrets are returned ONCE",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("rotate")`/api/robot-accounts/${idParam}/rotate`
      .addSuccess(RotatedRobotAccountBearer)
      .annotateContext(
        OpenApi.annotations({
          title: "Rotate robot account bearer",
          description:
            "Re-mint a robot account's bearer secret; any linked vault identity is left untouched",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("revoke")`/api/robot-accounts/${idParam}`
      .addSuccess(DeletedResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Revoke robot account",
          description:
            "Delete a robot account by id (org-scoped; no cross-organization deletes). Any linked vault identity's own recipient row is untouched — revoke its vault access separately",
        }),
      ),
  )
  .addError(NotFound)
  .addError(Conflict)
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "Robot Accounts",
      description: "IAM-gated org-owned CI robot account mint / list / rotate / revoke",
    }),
  ) {}
