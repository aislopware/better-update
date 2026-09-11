import { Context, Effect, Layer } from "effect";

import { kyselyDb } from "../cloudflare/db";

import type { BuildInstallArtifactModel } from "../models";

// -- Port ------------------------------------------------------------------

// The universal APK attached to an `aab` build. Reads that need it alongside
// the build go through `selectBuildsWithArtifact` (build-row.ts); this port
// covers the write path and the two id-only lookups the raw download route
// makes without loading the whole build.

export interface InstallArtifactRepository {
  /**
   * Insert-or-replace the install artifact of a build. Re-attaching for the
   * same build overwrites the previous record — the R2 key is deterministic,
   * so the object was overwritten in place too.
   */
  readonly upsert: (params: {
    readonly buildId: string;
    readonly r2Key: string;
    readonly contentType: string;
    readonly byteSize: number;
    readonly sha256: string;
  }) => Effect.Effect<BuildInstallArtifactModel>;

  readonly findR2KeyByBuildId: (params: {
    readonly buildId: string;
  }) => Effect.Effect<string | null>;

  /** Org-scoped lookup for the session-authenticated download path. */
  readonly findAccessInfoByBuildIdAndOrg: (params: {
    readonly buildId: string;
    readonly organizationId: string;
  }) => Effect.Effect<{ readonly projectId: string; readonly r2Key: string } | null>;
}

export class InstallArtifactRepo extends Context.Service<
  InstallArtifactRepo,
  InstallArtifactRepository
>()("api/InstallArtifactRepo") {}

// -- D1 Adapter ------------------------------------------------------------

export const InstallArtifactRepoLive = Layer.succeed(InstallArtifactRepo, {
  upsert: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const now = new Date().toISOString();
      yield* Effect.promise(async () =>
        db
          .insertInto("build_install_artifacts")
          .values({
            build_id: params.buildId,
            r2_key: params.r2Key,
            content_type: params.contentType,
            byte_size: params.byteSize,
            sha256: params.sha256,
            created_at: now,
          })
          .onConflict((oc) =>
            oc.column("build_id").doUpdateSet({
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
        r2Key: params.r2Key,
        contentType: params.contentType,
        byteSize: params.byteSize,
        sha256: params.sha256,
        createdAt: now,
      } satisfies BuildInstallArtifactModel;
    }),

  findR2KeyByBuildId: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("build_install_artifacts")
          .select("r2_key")
          .where("build_id", "=", params.buildId)
          .executeTakeFirst(),
      );
      return row ? row.r2_key : null;
    }),

  findAccessInfoByBuildIdAndOrg: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("build_install_artifacts as i")
          .innerJoin("builds as b", "b.id", "i.build_id")
          .innerJoin("projects as p", "p.id", "b.project_id")
          .select(["i.r2_key", "b.project_id"])
          .where("i.build_id", "=", params.buildId)
          .where("p.organization_id", "=", params.organizationId)
          .executeTakeFirst(),
      );
      return row ? { projectId: row.project_id, r2Key: row.r2_key } : null;
    }),
});
