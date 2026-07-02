import { Context, Effect, Layer } from "effect";
import { sql } from "kysely";

import type { Kysely, Selectable } from "kysely";

import { kyselyDb } from "../cloudflare/db";
import { NotFound } from "../errors";

import type { AppleTeams, DB } from "../db/schema";
import type { AppleTeamModel, AppleTeamType } from "../models";

// -- Port -------------------------------------------------------------------

export interface AppleTeamWithCounts extends AppleTeamModel {
  readonly distributionCertificateCount: number;
  readonly pushKeyCount: number;
  readonly ascApiKeyCount: number;
  readonly provisioningProfileCount: number;
  readonly deviceCount: number;
}

export interface AppleTeamRepository {
  readonly upsertByAppleTeamId: (params: {
    readonly organizationId: string;
    readonly appleTeamId: string;
    readonly appleTeamType: AppleTeamType;
    readonly name: string | null;
  }) => Effect.Effect<AppleTeamModel>;

  readonly findById: (params: { readonly id: string }) => Effect.Effect<AppleTeamModel, NotFound>;

  readonly findByAppleTeamId: (params: {
    readonly organizationId: string;
    readonly appleTeamId: string;
  }) => Effect.Effect<AppleTeamModel, NotFound>;

  readonly listWithCounts: (params: {
    readonly organizationId: string;
  }) => Effect.Effect<readonly AppleTeamWithCounts[]>;

  /** Light projection (no counts) — backs the authz team-scope translation. */
  readonly listByOrg: (params: {
    readonly organizationId: string;
  }) => Effect.Effect<readonly AppleTeamModel[]>;

  readonly delete: (params: { readonly id: string }) => Effect.Effect<void>;
}

export class AppleTeamRepo extends Context.Tag("api/AppleTeamRepo")<
  AppleTeamRepo,
  AppleTeamRepository
>() {}

// -- D1 Adapter -------------------------------------------------------------

/**
 * Base projection with correlated COUNT subqueries for each credential
 * category attached to an Apple team. Used exclusively by `listWithCounts`.
 */
const selectAppleTeamWithCounts = (db: Kysely<DB>) =>
  db
    .selectFrom("apple_teams as t")
    .select([
      "t.id",
      "t.organization_id",
      "t.apple_team_id",
      "t.apple_team_type",
      "t.name",
      "t.created_at",
      "t.updated_at",
      (eb) =>
        eb
          .selectFrom("apple_distribution_certificates")
          .select(eb.fn.countAll<number>().as("c"))
          .whereRef("apple_team_id", "=", "t.id")
          .as("distribution_certificate_count"),
      (eb) =>
        eb
          .selectFrom("apple_push_keys")
          .select(eb.fn.countAll<number>().as("c"))
          .whereRef("apple_team_id", "=", "t.id")
          .as("push_key_count"),
      (eb) =>
        eb
          .selectFrom("asc_api_keys")
          .select(eb.fn.countAll<number>().as("c"))
          .whereRef("apple_team_id", "=", "t.id")
          .as("asc_api_key_count"),
      (eb) =>
        eb
          .selectFrom("apple_provisioning_profiles")
          .select(eb.fn.countAll<number>().as("c"))
          .whereRef("apple_team_id", "=", "t.id")
          .as("provisioning_profile_count"),
      (eb) =>
        eb
          .selectFrom("devices")
          .select(eb.fn.countAll<number>().as("c"))
          .whereRef("apple_team_id", "=", "t.id")
          .as("device_count"),
    ]);

type AppleTeamWithCountsRow = Awaited<
  ReturnType<ReturnType<typeof selectAppleTeamWithCounts>["execute"]>
>[number];

const toModel = (row: Selectable<AppleTeams>): AppleTeamModel => ({
  id: row.id,
  organizationId: row.organization_id,
  appleTeamId: row.apple_team_id,
  appleTeamType: row.apple_team_type,
  name: row.name,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toModelWithCounts = (row: AppleTeamWithCountsRow): AppleTeamWithCounts => ({
  ...toModel(row),
  distributionCertificateCount: Number(row.distribution_certificate_count),
  pushKeyCount: Number(row.push_key_count),
  ascApiKeyCount: Number(row.asc_api_key_count),
  provisioningProfileCount: Number(row.provisioning_profile_count),
  deviceCount: Number(row.device_count),
});

export const AppleTeamRepoLive = Layer.succeed(AppleTeamRepo, {
  upsertByAppleTeamId: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      const row = yield* Effect.promise(async () =>
        db
          .insertInto("apple_teams")
          .values({
            id,
            organization_id: params.organizationId,
            apple_team_id: params.appleTeamId,
            apple_team_type: params.appleTeamType,
            name: params.name,
            created_at: now,
            updated_at: now,
          })
          .onConflict((oc) =>
            oc.columns(["organization_id", "apple_team_id"]).doUpdateSet((eb) => ({
              apple_team_type: eb.ref("excluded.apple_team_type"),
              // Preserve the stored name when the incoming name is null
              name: sql<string | null>`COALESCE(excluded."name", "apple_teams"."name")`,
              updated_at: eb.ref("excluded.updated_at"),
            })),
          )
          .returningAll()
          .executeTakeFirst(),
      );

      if (row === undefined) {
        return yield* Effect.die(new Error("Apple team upsert failed"));
      }
      return toModel(row);
    }),

  findById: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;

      const row = yield* Effect.promise(async () =>
        db.selectFrom("apple_teams").selectAll().where("id", "=", params.id).executeTakeFirst(),
      );

      if (!row) {
        return yield* new NotFound({ message: "Apple team not found" });
      }
      return toModel(row);
    }),

  findByAppleTeamId: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;

      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("apple_teams")
          .selectAll()
          .where("organization_id", "=", params.organizationId)
          .where("apple_team_id", "=", params.appleTeamId)
          .executeTakeFirst(),
      );

      if (!row) {
        return yield* new NotFound({ message: "Apple team not found" });
      }
      return toModel(row);
    }),

  listWithCounts: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;

      const rows = yield* Effect.promise(async () =>
        selectAppleTeamWithCounts(db)
          .where("t.organization_id", "=", params.organizationId)
          .orderBy("t.created_at", "desc")
          .execute(),
      );

      return rows.map(toModelWithCounts);
    }),

  listByOrg: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;

      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("apple_teams")
          .selectAll()
          .where("organization_id", "=", params.organizationId)
          .execute(),
      );

      return rows.map(toModel);
    }),

  delete: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;

      yield* Effect.promise(async () =>
        db.deleteFrom("apple_teams").where("id", "=", params.id).execute(),
      );
    }),
});
