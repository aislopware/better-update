import { compact } from "@better-update/type-guards";
import { Context, Effect, Layer } from "effect";

import { kyselyDb } from "../cloudflare/db";
import { d1WithUniqueCheck } from "./d1-helpers";

import type { Conflict } from "../errors";

// -- Port -------------------------------------------------------------------

export interface OrganizationModel {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly logoUrl: string | null;
}

export interface OrganizationRepository {
  readonly findById: (params: { readonly id: string }) => Effect.Effect<OrganizationModel | null>;

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

  /** Set (or clear, with `null`) the organization's logo URL. */
  readonly updateLogoUrl: (params: {
    readonly id: string;
    readonly logoUrl: string | null;
  }) => Effect.Effect<void>;
}

export class OrganizationRepo extends Context.Tag("api/OrganizationRepo")<
  OrganizationRepo,
  OrganizationRepository
>() {}

// -- D1 Adapter -------------------------------------------------------------

// `logo` is the better-auth organization-plugin's default column name; the
// domain model exposes it as `logoUrl` for naming parity with `Project`.
const COLUMNS = ["id", "name", "slug", "logo"] as const;

interface OrganizationRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly logo: string | null;
}

const toOrganization = (row: OrganizationRow): OrganizationModel => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  logoUrl: row.logo,
});

export const OrganizationRepoLive = Layer.succeed(OrganizationRepo, {
  findById: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("organization")
          .select(COLUMNS)
          .where("id", "=", params.id)
          .executeTakeFirst(),
      );
      return row ? toOrganization(row) : null;
    }),

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
        return current ? toOrganization(current) : null;
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
      return row ? toOrganization(row) : null;
    }),

  updateLogoUrl: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* Effect.promise(async () =>
        db
          .updateTable("organization")
          .set({ logo: params.logoUrl })
          .where("id", "=", params.id)
          .execute(),
      );
    }),
});
