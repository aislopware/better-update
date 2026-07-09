import { Context, Effect, Layer } from "effect";
import { chunk } from "es-toolkit";

import { D1_IN_PARAM_CHUNK, kyselyDb } from "../cloudflare/db";

import type {
  BuildDebugArtifactModel,
  DebugArtifactType,
  UpdateSourcemapModel,
} from "../debug-artifact-models";

// -- Port ------------------------------------------------------------------

export interface DebugArtifactRepository {
  /**
   * Insert-or-replace a build debug artifact. Re-running a capture for the
   * same (build, type) overwrites the previous record — the R2 key is
   * deterministic, so the object was overwritten in place too.
   */
  readonly upsertBuildArtifact: (params: {
    readonly buildId: string;
    readonly type: DebugArtifactType;
    readonly r2Key: string;
    readonly contentType: string;
    readonly byteSize: number;
    readonly sha256: string;
  }) => Effect.Effect<BuildDebugArtifactModel>;

  readonly listByBuildId: (params: {
    readonly buildId: string;
  }) => Effect.Effect<readonly BuildDebugArtifactModel[]>;

  readonly findByBuildIdAndType: (params: {
    readonly buildId: string;
    readonly type: DebugArtifactType;
  }) => Effect.Effect<BuildDebugArtifactModel | null>;

  readonly listR2KeysByBuildIds: (params: {
    readonly buildIds: readonly string[];
  }) => Effect.Effect<readonly string[]>;

  readonly deleteByBuildIds: (params: {
    readonly buildIds: readonly string[];
  }) => Effect.Effect<void>;

  /** Insert-or-replace the sourcemap of an update (one per update). */
  readonly upsertUpdateSourcemap: (params: {
    readonly updateId: string;
    readonly r2Key: string;
    readonly byteSize: number;
    readonly sha256: string;
  }) => Effect.Effect<UpdateSourcemapModel>;

  readonly findSourcemapByUpdateId: (params: {
    readonly updateId: string;
  }) => Effect.Effect<UpdateSourcemapModel | null>;

  readonly listSourcemapR2KeysByUpdateIds: (params: {
    readonly updateIds: readonly string[];
  }) => Effect.Effect<readonly string[]>;
}

export class DebugArtifactRepo extends Context.Tag("api/DebugArtifactRepo")<
  DebugArtifactRepo,
  DebugArtifactRepository
>() {}

// -- D1 Adapter ------------------------------------------------------------

interface BuildDebugArtifactRow {
  readonly build_id: string;
  readonly type: DebugArtifactType;
  readonly r2_key: string;
  readonly content_type: string;
  readonly byte_size: number;
  readonly sha256: string;
  readonly created_at: string;
}

const toBuildDebugArtifact = (row: BuildDebugArtifactRow): BuildDebugArtifactModel => ({
  buildId: row.build_id,
  type: row.type,
  r2Key: row.r2_key,
  contentType: row.content_type,
  byteSize: row.byte_size,
  sha256: row.sha256,
  createdAt: row.created_at,
});

export const DebugArtifactRepoLive = Layer.succeed(DebugArtifactRepo, {
  upsertBuildArtifact: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const now = new Date().toISOString();
      yield* Effect.promise(async () =>
        db
          .insertInto("build_debug_artifacts")
          .values({
            build_id: params.buildId,
            type: params.type,
            r2_key: params.r2Key,
            content_type: params.contentType,
            byte_size: params.byteSize,
            sha256: params.sha256,
            created_at: now,
          })
          .onConflict((oc) =>
            oc.columns(["build_id", "type"]).doUpdateSet({
              r2_key: params.r2Key,
              content_type: params.contentType,
              byte_size: params.byteSize,
              sha256: params.sha256,
              created_at: now,
            }),
          )
          .execute(),
      );
      return {
        buildId: params.buildId,
        type: params.type,
        r2Key: params.r2Key,
        contentType: params.contentType,
        byteSize: params.byteSize,
        sha256: params.sha256,
        createdAt: now,
      } satisfies BuildDebugArtifactModel;
    }),

  listByBuildId: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("build_debug_artifacts")
          .selectAll()
          .where("build_id", "=", params.buildId)
          .orderBy("type", "asc")
          .execute(),
      );
      return rows.map(toBuildDebugArtifact);
    }),

  findByBuildIdAndType: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("build_debug_artifacts")
          .selectAll()
          .where("build_id", "=", params.buildId)
          .where("type", "=", params.type)
          .executeTakeFirst(),
      );
      return row ? toBuildDebugArtifact(row) : null;
    }),

  listR2KeysByBuildIds: (params) =>
    Effect.gen(function* () {
      if (params.buildIds.length === 0) {
        return [];
      }
      const db = yield* kyselyDb;
      const batches = yield* Effect.forEach(chunk([...params.buildIds], D1_IN_PARAM_CHUNK), (ids) =>
        Effect.promise(async () =>
          db
            .selectFrom("build_debug_artifacts")
            .select("r2_key")
            .where("build_id", "in", ids)
            .execute(),
        ),
      );
      return batches.flat().map((row) => row.r2_key);
    }),

  deleteByBuildIds: (params) =>
    Effect.gen(function* () {
      if (params.buildIds.length === 0) {
        return;
      }
      const db = yield* kyselyDb;
      yield* Effect.forEach(chunk([...params.buildIds], D1_IN_PARAM_CHUNK), (ids) =>
        Effect.promise(async () =>
          db.deleteFrom("build_debug_artifacts").where("build_id", "in", ids).execute(),
        ),
      );
    }),

  upsertUpdateSourcemap: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const now = new Date().toISOString();
      yield* Effect.promise(async () =>
        db
          .insertInto("update_sourcemaps")
          .values({
            update_id: params.updateId,
            r2_key: params.r2Key,
            byte_size: params.byteSize,
            sha256: params.sha256,
            created_at: now,
          })
          .onConflict((oc) =>
            oc.column("update_id").doUpdateSet({
              r2_key: params.r2Key,
              byte_size: params.byteSize,
              sha256: params.sha256,
              created_at: now,
            }),
          )
          .execute(),
      );
      return {
        updateId: params.updateId,
        r2Key: params.r2Key,
        byteSize: params.byteSize,
        sha256: params.sha256,
        createdAt: now,
      } satisfies UpdateSourcemapModel;
    }),

  findSourcemapByUpdateId: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("update_sourcemaps")
          .selectAll()
          .where("update_id", "=", params.updateId)
          .executeTakeFirst(),
      );
      return row
        ? {
            updateId: row.update_id,
            r2Key: row.r2_key,
            byteSize: row.byte_size,
            sha256: row.sha256,
            createdAt: row.created_at,
          }
        : null;
    }),

  listSourcemapR2KeysByUpdateIds: (params) =>
    Effect.gen(function* () {
      if (params.updateIds.length === 0) {
        return [];
      }
      const db = yield* kyselyDb;
      const batches = yield* Effect.forEach(
        chunk([...params.updateIds], D1_IN_PARAM_CHUNK),
        (ids) =>
          Effect.promise(async () =>
            db
              .selectFrom("update_sourcemaps")
              .select("r2_key")
              .where("update_id", "in", ids)
              .execute(),
          ),
      );
      return batches.flat().map((row) => row.r2_key);
    }),
});
