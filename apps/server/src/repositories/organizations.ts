import { toDbNull } from "@better-update/type-guards";
import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";
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

interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
}

export const OrganizationRepoLive = Layer.succeed(OrganizationRepo, {
  update: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const row = yield* d1WithUniqueCheck(
        async () =>
          env.DB.prepare(
            `UPDATE "organization"
               SET "name" = COALESCE(?, "name"), "slug" = COALESCE(?, "slug")
             WHERE "id" = ?
             RETURNING "id", "name", "slug"`,
          )
            .bind(toDbNull(params.name), toDbNull(params.slug), params.id)
            .first<OrganizationRow>(),
        "An organization with this slug already exists",
      );
      return row === null ? null : { id: row.id, name: row.name, slug: row.slug };
    }),
});
