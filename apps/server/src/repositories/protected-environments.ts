import { Context, Effect, Layer } from "effect";

import { kyselyDb } from "../cloudflare/db";

// -- Port ------------------------------------------------------------------
// Protected environments (docs/specs/authz/ROLES-CAPABILITIES-SPEC.md §2d).
// Presence of a row = the environment name is protected in that org. Works for
// built-in (virtual) and custom environment names alike.

export interface ProtectedEnvironmentRepository {
  readonly listByOrg: (params: {
    readonly organizationId: string;
  }) => Effect.Effect<ReadonlySet<string>>;

  /** Idempotent: protecting an already-protected environment is a no-op. */
  readonly protect: (params: {
    readonly organizationId: string;
    readonly environment: string;
    readonly createdAt: string;
  }) => Effect.Effect<void>;

  /** Idempotent: unprotecting deletes the row if present. */
  readonly unprotect: (params: {
    readonly organizationId: string;
    readonly environment: string;
  }) => Effect.Effect<void>;
}

export class ProtectedEnvironmentRepo extends Context.Tag("api/ProtectedEnvironmentRepo")<
  ProtectedEnvironmentRepo,
  ProtectedEnvironmentRepository
>() {}

// -- D1 Adapter ------------------------------------------------------------

export const ProtectedEnvironmentRepoLive = Layer.succeed(ProtectedEnvironmentRepo, {
  listByOrg: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("protected_environment")
          .select("environment")
          .where("organization_id", "=", params.organizationId)
          .execute(),
      );
      return new Set(rows.map((row) => row.environment));
    }),

  protect: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* Effect.promise(async () =>
        db
          .insertInto("protected_environment")
          .values({
            organization_id: params.organizationId,
            environment: params.environment,
            created_at: params.createdAt,
          })
          .onConflict((oc) => oc.doNothing())
          .execute(),
      );
    }),

  unprotect: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* Effect.promise(async () =>
        db
          .deleteFrom("protected_environment")
          .where("organization_id", "=", params.organizationId)
          .where("environment", "=", params.environment)
          .execute(),
      );
    }),
});
