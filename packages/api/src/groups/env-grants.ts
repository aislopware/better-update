import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import {
  DeleteEnvGrantBody,
  DeleteEnvGrantResult,
  EnvGrant,
  EnvGrantRow,
  ListEnvGrantsParams,
  UpsertEnvGrantBody,
} from "../domain/env-grant";
import { BadRequest } from "../domain/errors";

export class EnvGrantsGroup extends HttpApiGroup.make("envGrants")
  .add(
    HttpApiEndpoint.get("list", "/api/env-grants")
      .setUrlParams(ListEnvGrantsParams)
      .addSuccess(Schema.Array(EnvGrantRow))
      .annotateContext(
        OpenApi.annotations({
          title: "List env-var environment grants",
          description:
            "List per-member allow/deny env-var grants on a project-or-global scope across all environments. projectId is a real id or the sentinel 'global'.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.put("upsert", "/api/env-grants")
      .setPayload(UpsertEnvGrantBody)
      .addSuccess(EnvGrant)
      .annotateContext(
        OpenApi.annotations({
          title: "Upsert env-var environment grant",
          description:
            "Create or replace a member's allow/deny env-var grant on one (project-or-global × environment) scope. projectId null = org-global.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("delete", "/api/env-grants")
      .setPayload(DeleteEnvGrantBody)
      .addSuccess(DeleteEnvGrantResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Delete env-var environment grants",
          description:
            "Revoke both allow and deny grants for a member on one (project-or-global × environment) scope.",
        }),
      ),
  )
  .addError(NotFound)
  .addError(Forbidden)
  .addError(BadRequest)
  .annotateContext(
    OpenApi.annotations({
      title: "Env-var environment grants",
      description:
        "Per (project × environment) ABAC permission grants for env vars (allow/deny by member)",
    }),
  ) {}
