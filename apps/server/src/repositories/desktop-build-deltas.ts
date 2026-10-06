import { Context, Effect, Layer } from "effect";

import type { Kysely } from "kysely";

import { kyselyDb } from "../cloudflare/db";

import type { DB } from "../db/schema";
import type { SparkleDeltaModel } from "../desktop-release-models";

// -- Port ------------------------------------------------------------------

export interface DesktopBuildDeltaRepository {
  /**
   * Store a build's delta from `deltaFrom`, replacing any earlier one from that
   * version; returns the replaced delta's R2 key, whose object is now unused.
   */
  readonly upsert: (params: {
    readonly id: string;
    readonly buildId: string;
    readonly deltaFrom: string;
    readonly r2Key: string;
    readonly byteSize: number;
    readonly sha256: string;
    readonly edSignature: string;
    readonly sparkleExecutableSize: number | null;
    readonly sparkleLocales: string | null;
    readonly now: string;
  }) => Effect.Effect<{ readonly delta: SparkleDeltaModel; readonly replacedR2Key: string | null }>;

  /** The deltas of each build, oldest `deltaFrom` first per build. */
  readonly listByBuilds: (params: {
    readonly buildIds: readonly string[];
  }) => Effect.Effect<readonly SparkleDeltaModel[]>;

  /** One delta, for the public download redirect. */
  readonly findById: (params: { readonly id: string }) => Effect.Effect<SparkleDeltaModel | null>;
}

export class DesktopBuildDeltaRepo extends Context.Service<
  DesktopBuildDeltaRepo,
  DesktopBuildDeltaRepository
>()("api/DesktopBuildDeltaRepo") {}

// -- D1 Adapter ------------------------------------------------------------

const DELTA_COLUMNS = [
  "id",
  "build_id",
  "delta_from",
  "r2_key",
  "byte_size",
  "sha256",
  "ed_signature",
  "sparkle_executable_size",
  "sparkle_locales",
  "created_at",
] as const;

const selectDeltas = (db: Kysely<DB>) =>
  db.selectFrom("desktop_build_deltas").select(DELTA_COLUMNS);

type DeltaRow = Awaited<ReturnType<ReturnType<typeof selectDeltas>["executeTakeFirstOrThrow"]>>;

const toModel = (row: DeltaRow): SparkleDeltaModel => ({
  id: row.id,
  buildId: row.build_id,
  deltaFrom: row.delta_from,
  r2Key: row.r2_key,
  byteSize: row.byte_size,
  sha256: row.sha256,
  edSignature: row.ed_signature,
  sparkleExecutableSize: row.sparkle_executable_size,
  sparkleLocales: row.sparkle_locales,
  createdAt: row.created_at,
});

/** D1 caps bound parameters per statement; a feed never lists more builds than this. */
const MAX_BUILDS = 90;

export const DesktopBuildDeltaRepoLive = Layer.succeed(DesktopBuildDeltaRepo, {
  upsert: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const previous = yield* Effect.promise(async () =>
        db
          .selectFrom("desktop_build_deltas")
          .select(["r2_key"])
          .where("build_id", "=", params.buildId)
          .where("delta_from", "=", params.deltaFrom)
          .executeTakeFirst(),
      );
      const values = {
        id: params.id,
        build_id: params.buildId,
        delta_from: params.deltaFrom,
        r2_key: params.r2Key,
        byte_size: params.byteSize,
        sha256: params.sha256,
        ed_signature: params.edSignature,
        sparkle_executable_size: params.sparkleExecutableSize,
        sparkle_locales: params.sparkleLocales,
        created_at: params.now,
      };
      yield* Effect.promise(async () =>
        db
          .insertInto("desktop_build_deltas")
          .values(values)
          .onConflict((conflict) =>
            conflict.columns(["build_id", "delta_from"]).doUpdateSet({
              id: values.id,
              r2_key: values.r2_key,
              byte_size: values.byte_size,
              sha256: values.sha256,
              ed_signature: values.ed_signature,
              sparkle_executable_size: values.sparkle_executable_size,
              sparkle_locales: values.sparkle_locales,
              created_at: values.created_at,
            }),
          )
          .execute(),
      );
      const row = yield* Effect.promise(async () =>
        selectDeltas(db)
          .where("build_id", "=", params.buildId)
          .where("delta_from", "=", params.deltaFrom)
          .executeTakeFirstOrThrow(),
      );
      const replaced = previous?.r2_key;
      return {
        delta: toModel(row),
        replacedR2Key: replaced === undefined || replaced === params.r2Key ? null : replaced,
      };
    }),

  listByBuilds: (params) =>
    Effect.gen(function* () {
      if (params.buildIds.length === 0) {
        return [];
      }
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        selectDeltas(db)
          .where("build_id", "in", [...new Set(params.buildIds)].slice(0, MAX_BUILDS))
          .orderBy("build_id")
          .orderBy("created_at")
          .execute(),
      );
      return rows.map(toModel);
    }),

  findById: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        selectDeltas(db).where("id", "=", params.id).executeTakeFirst(),
      );
      return row === undefined ? null : toModel(row);
    }),
});
