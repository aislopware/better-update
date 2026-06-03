import { Effect } from "effect";

import { NotFound } from "../errors";
import { ProjectRepo } from "../repositories/projects";
import { CurrentActor } from "./current-actor";

/** Returns 404 (not 403) for cross-org access to prevent org enumeration. */
export const assertOrgOwnership = (resourceOrgId: string) =>
  Effect.gen(function* () {
    const ctx = yield* CurrentActor;
    if (resourceOrgId !== ctx.organizationId) {
      return yield* new NotFound({ message: "Resource not found" });
    }
  });

export const assertProjectOwnership = (projectId: string) =>
  Effect.gen(function* () {
    const repo = yield* ProjectRepo;
    const orgId = yield* repo.findOrgIdById({ id: projectId });
    yield* assertOrgOwnership(orgId);
  });
