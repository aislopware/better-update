import { compact, toDbNull } from "@better-update/type-guards";
import { Context, Effect, Layer } from "effect";

import { kyselyDb } from "../cloudflare/db";
import { d1WithUniqueCheck } from "./d1-helpers";

import type { Conflict } from "../errors";

// -- Port -------------------------------------------------------------------

export interface OrganizationModel {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

export interface OrganizationRepository {
  /**
   * Patch the active org's name/slug (only provided fields change). `null` when
   * the row is absent. Fails {@link Conflict} when the new slug collides (the
   * `organization.slug` column is UNIQUE).
   */
  readonly update: (params: {
    readonly id: string;
    readonly name?: string;
    readonly slug?: string;
  }) => Effect.Effect<OrganizationModel | null, Conflict>;
}

export class OrganizationRepo extends Context.Tag("api/OrganizationRepo")<
  OrganizationRepo,
  OrganizationRepository
>() {}

// -- D1 Adapter -------------------------------------------------------------

const COLUMNS = ["id", "name", "slug"] as const;

export const OrganizationRepoLive = Layer.succeed(OrganizationRepo, {
  update: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const patch = compact({ name: params.name, slug: params.slug });

      // Nothing to change → return the row unchanged. Kysely rejects an empty
      // SET, so this stands in for the old `COALESCE(?, col)` no-op update.
      if (Object.keys(patch).length === 0) {
        const current = yield* Effect.promise(async () =>
          db
            .selectFrom("organization")
            .select(COLUMNS)
            .where("id", "=", params.id)
            .executeTakeFirst(),
        );
        return toDbNull(current);
      }

      const row = yield* d1WithUniqueCheck(
        async () =>
          db
            .updateTable("organization")
            .set(patch)
            .where("id", "=", params.id)
            .returning(COLUMNS)
            .executeTakeFirst(),
        "An organization with this slug already exists",
      );
      return toDbNull(row);
    }),
});
