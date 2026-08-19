import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { DeletedResult, idParam } from "../domain/common";
import {
  CredentialBinding,
  CredentialBindingList,
  CredentialBindingPlan,
  CredentialBindingType,
  OrgCredentialBinding,
} from "../domain/credential-binding";
import { BadRequest, Conflict } from "../domain/errors";

const resourceTypeParam = { resourceType: CredentialBindingType };
const resourceIdParam = { resourceId: Schema.String };

export const CredentialBindingsGroup = HttpApiGroup.make("credential-bindings")
  .add(
    HttpApiEndpoint.get("plan", "/api/credential-bindings/plan", {
      success: CredentialBindingPlan,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Plan credential bindings",
        description:
          "Bindings the org's existing project configs (iOS bundle configurations, Android build-credential groups) rely on, with their current bound/missing state — feed the missing ones to the bind route (`credentials bindings plan --apply`). Requires org admin.",
      }),
    ),
    HttpApiEndpoint.get("list", "/api/projects/:id/credential-bindings", {
      params: { ...idParam },
      success: CredentialBindingList,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "List credential bindings",
        description:
          "Org credentials bound to this project (GITLAB-RBAC-SPEC §1a). Requires org admin.",
      }),
    ),
    HttpApiEndpoint.put("bind", "/api/projects/:id/credential-bindings/:resourceType/:resourceId", {
      params: { ...idParam, ...resourceTypeParam, ...resourceIdParam },
      success: CredentialBinding.pipe(HttpApiSchema.status(201)),
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Bind credential to project",
        description:
          "Make an org credential usable in this project — idempotent. `appleTeam` bindings cover every child credential and the team's devices; `ascApiKey` is for team-less keys only. Requires org admin.",
      }),
    ),
    HttpApiEndpoint.make("DELETE")(
      "unbind",
      "/api/projects/:id/credential-bindings/:resourceType/:resourceId",
      {
        params: { ...idParam, ...resourceTypeParam, ...resourceIdParam },
        success: DeletedResult,
        error: [NotFound, Conflict, BadRequest, Forbidden],
      },
    ).annotateMerge(
      OpenApi.annotations({
        title: "Unbind credential from project",
        description:
          "Remove a credential's binding — the project's members (and its robot) lose access to it. Requires org admin.",
      }),
    ),
    HttpApiEndpoint.put(
      "bindAllProjects",
      "/api/credential-bindings/all-projects/:resourceType/:resourceId",
      {
        params: { ...resourceTypeParam, ...resourceIdParam },
        success: OrgCredentialBinding.pipe(HttpApiSchema.status(201)),
        error: [NotFound, Conflict, BadRequest, Forbidden],
      },
    ).annotateMerge(
      OpenApi.annotations({
        title: "Bind credential to all projects",
        description:
          "Make an org credential usable in EVERY project of the org — including projects created later (no per-project fan-out). Idempotent. `appleTeam` bindings cover every child credential and the team's devices; `ascApiKey` is for team-less keys only. Requires org admin.",
      }),
    ),
    HttpApiEndpoint.make("DELETE")(
      "unbindAllProjects",
      "/api/credential-bindings/all-projects/:resourceType/:resourceId",
      {
        params: { ...resourceTypeParam, ...resourceIdParam },
        success: DeletedResult,
        error: [NotFound, Conflict, BadRequest, Forbidden],
      },
    ).annotateMerge(
      OpenApi.annotations({
        title: "Unbind credential from all projects",
        description:
          "Remove a credential's org-wide binding — access falls back to its explicit per-project bindings (if any). Requires org admin.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Credential bindings",
      description: "Project bindings for org-scoped credentials (GitLab-style RBAC, spec §1a/§3c)",
    }),
  );
