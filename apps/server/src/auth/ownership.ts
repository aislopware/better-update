import { AuthContext, NotFound } from "@better-update/api";
import { Effect } from "effect";

export { NotFound } from "@better-update/api";

/** Returns 404 (not 403) for cross-org access to prevent org enumeration. */
export const assertOrgOwnership = (resourceOrgId: string) =>
  Effect.gen(function* () {
    const ctx = yield* AuthContext;
    if (resourceOrgId !== ctx.organizationId) {
      yield* new NotFound({ message: "Resource not found" });
    }
  });
