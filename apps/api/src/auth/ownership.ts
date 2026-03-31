import { HttpApiSchema } from "@effect/platform";
import { Effect, Schema } from "effect";

import { AuthContext } from "./context";

export class NotFound extends Schema.TaggedError<NotFound>()(
  "NotFound",
  { message: Schema.String },
  HttpApiSchema.annotations({ status: 404 }),
) {}

/** Returns 404 (not 403) for cross-org access to prevent org enumeration. */
export const assertOrgOwnership = (resourceOrgId: string) =>
  Effect.gen(function* () {
    const ctx = yield* AuthContext;
    if (resourceOrgId !== ctx.organizationId) {
      yield* new NotFound({ message: "Resource not found" });
    }
  });
