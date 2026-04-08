import { AuthContext, NotFound } from "@better-update/api";
import { Effect } from "effect";

import { ProjectRepo } from "../repositories/projects";

export { NotFound } from "@better-update/api";

/** Returns 404 (not 403) for cross-org access to prevent org enumeration. */
export const assertOrgOwnership = (resourceOrgId: string) =>
  Effect.gen(function* () {
    const ctx = yield* AuthContext;
    if (resourceOrgId !== ctx.organizationId) {
      yield* new NotFound({ message: "Resource not found" });
    }
  });

export const assertProjectOwnership = (projectId: string) =>
  Effect.gen(function* () {
    const repo = yield* ProjectRepo;
    const orgId = yield* repo.findOrgIdById({ id: projectId });
    yield* assertOrgOwnership(orgId);
  });
