import { Context, Effect, Layer } from "effect";

import type { Expression, Kysely, SqlBool } from "kysely";

import { kyselyDb } from "../cloudflare/db";
import { NotFound } from "../errors";

import type { DB } from "../db/schema";
import type {
  DesktopArtifactFormat,
  DesktopFeedEntry,
  DesktopPlatform,
  DesktopReleaseModel,
} from "../desktop-release-models";

// -- Port ------------------------------------------------------------------

export interface DesktopReleaseRepository {
  readonly insert: (params: {
    readonly id: string;
    readonly projectId: string;
    readonly buildId: string;
    readonly channel: string;
    readonly releaseNotes: string | null;
    readonly critical: boolean;
    readonly rolloutPercentage: number;
    readonly phasedRolloutHours: number | null;
    readonly sha512: string;
    readonly sparkleEdSignature: string | null;
    readonly winSparkleEdSignature: string | null;
    readonly tauriSignature: string | null;
    readonly blockmap: boolean;
    readonly now: string;
  }) => Effect.Effect<void>;

  /** Re-releasing a build to a channel replaces the release's content. */
  readonly findByBuildAndChannel: (params: {
    readonly buildId: string;
    readonly channel: string;
  }) => Effect.Effect<DesktopReleaseModel | null>;

  readonly findById: (params: {
    readonly id: string;
  }) => Effect.Effect<DesktopReleaseModel, NotFound>;

  readonly listByProject: (params: {
    readonly projectId: string;
    readonly platform?: DesktopPlatform | undefined;
    readonly channel?: string | undefined;
    readonly buildId?: string | undefined;
    readonly limit: number;
    readonly offset: number;
  }) => Effect.Effect<{ readonly items: readonly DesktopReleaseModel[]; readonly total: number }>;

  readonly update: (params: {
    readonly id: string;
    readonly halted?: boolean | undefined;
    readonly rolloutPercentage?: number | undefined;
    readonly phasedRolloutHours?: number | null | undefined;
    readonly releaseNotes?: string | null | undefined;
    readonly critical?: boolean | undefined;
    readonly sha512?: string | undefined;
    readonly sparkleEdSignature?: string | null | undefined;
    readonly winSparkleEdSignature?: string | null | undefined;
    readonly tauriSignature?: string | null | undefined;
    readonly blockmap?: boolean | undefined;
    readonly now: string;
  }) => Effect.Effect<void>;

  readonly delete: (params: { readonly id: string }) => Effect.Effect<void>;

  /**
   * The live (non-halted) releases of one platform's builds a feed renders,
   * newest first. `channel` narrows to one channel (electron-updater reads one
   * file per channel); omitted, every channel (a Sparkle appcast tags items
   * per channel).
   */
  readonly listFeed: (params: {
    readonly projectId: string;
    readonly platform: DesktopPlatform;
    readonly channel?: string | undefined;
    readonly limit: number;
  }) => Effect.Effect<readonly DesktopFeedEntry[]>;

  /** A live release of the project's builds for one platform, for the public download redirect. */
  readonly findFeedEntry: (params: {
    readonly projectId: string;
    readonly platform: DesktopPlatform;
    readonly id: string;
  }) => Effect.Effect<DesktopFeedEntry | null>;

  /**
   * The project's releases of one app version in one format (`.zip`, `.exe`)
   * that carry a blockmap, halted ones included (a machine may still run
   * one), newest first: where the blockmap of the version an updater runs
   * comes from.
   */
  readonly listBlockmapReleases: (params: {
    readonly projectId: string;
    readonly platform: DesktopPlatform;
    readonly format: DesktopArtifactFormat;
    readonly appVersion: string;
    readonly limit: number;
  }) => Effect.Effect<readonly DesktopFeedEntry[]>;
}

export class DesktopReleaseRepo extends Context.Service<
  DesktopReleaseRepo,
  DesktopReleaseRepository
>()("api/DesktopReleaseRepo") {}

// -- D1 Adapter ------------------------------------------------------------

/**
 * Every read joins the build (platform, version, bundle id, metadata), its
 * artifact (format, size, R2 key) and the project (organization, for
 * ownership checks). Releases exist only for desktop builds, so the platform
 * and the artifact format are desktop ones.
 */
const selectReleases = (db: Kysely<DB>) =>
  db
    .selectFrom("desktop_releases as r")
    .innerJoin("builds as b", "b.id", "r.build_id")
    .innerJoin("build_artifacts as a", "a.build_id", "r.build_id")
    .innerJoin("projects as p", "p.id", "r.project_id")
    .select((eb) => [
      eb.ref("r.id").$castTo<string>().as("id"),
      "p.organization_id",
      "r.project_id",
      "r.build_id",
      eb.ref("b.platform").$castTo<DesktopPlatform>().as("platform"),
      "r.channel",
      "r.release_notes",
      "r.critical",
      "r.rollout_percentage",
      "r.phased_rollout_hours",
      "r.halted",
      "r.sha512",
      "r.sparkle_ed_signature",
      "r.winsparkle_ed_signature",
      "r.tauri_signature",
      "r.blockmap",
      "r.created_at",
      "r.updated_at",
      "b.app_version",
      "b.build_number",
      "b.bundle_id",
      "b.metadata_json",
      eb.ref("a.format").$castTo<DesktopArtifactFormat>().as("format"),
      "a.byte_size",
      "a.r2_key",
      eb.ref("a.sha256").as("artifact_sha256"),
      eb
        .selectFrom("desktop_build_deltas as d")
        .select((sub) => sub.fn.countAll<number>().as("count"))
        .whereRef("d.build_id", "=", "r.build_id")
        .as("sparkle_deltas"),
    ]);

type ReleaseRow = Awaited<ReturnType<ReturnType<typeof selectReleases>["executeTakeFirstOrThrow"]>>;

const toFeedEntry = (row: ReleaseRow): DesktopFeedEntry => ({
  id: row.id,
  organizationId: row.organization_id,
  projectId: row.project_id,
  buildId: row.build_id,
  platform: row.platform,
  channel: row.channel,
  appVersion: row.app_version,
  buildNumber: row.build_number,
  artifactFormat: row.format,
  releaseNotes: row.release_notes,
  critical: row.critical === 1,
  rolloutPercentage: row.rollout_percentage,
  phasedRolloutHours: row.phased_rollout_hours,
  halted: row.halted === 1,
  sha512: row.sha512,
  sparkleEdSignature: row.sparkle_ed_signature,
  winSparkleEdSignature: row.winsparkle_ed_signature,
  tauriSignature: row.tauri_signature,
  blockmap: row.blockmap === 1,
  sparkleDeltas: row.sparkle_deltas ?? 0,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  bundleId: row.bundle_id,
  metadataJson: row.metadata_json,
  byteSize: row.byte_size,
  r2Key: row.r2_key,
  sha256: row.artifact_sha256,
});

const newestFirst = (query: ReturnType<typeof selectReleases>) =>
  query.orderBy("r.created_at", "desc").orderBy("r.id", "desc");

const compactConditions = (
  conditions: readonly (Expression<SqlBool> | null)[],
): Expression<SqlBool>[] => conditions.filter((cond): cond is Expression<SqlBool> => cond !== null);

export const DesktopReleaseRepoLive = Layer.succeed(DesktopReleaseRepo, {
  insert: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* Effect.promise(async () =>
        db
          .insertInto("desktop_releases")
          .values({
            id: params.id,
            project_id: params.projectId,
            build_id: params.buildId,
            channel: params.channel,
            release_notes: params.releaseNotes,
            critical: params.critical ? 1 : 0,
            rollout_percentage: params.rolloutPercentage,
            phased_rollout_hours: params.phasedRolloutHours,
            halted: 0,
            sha512: params.sha512,
            sparkle_ed_signature: params.sparkleEdSignature,
            winsparkle_ed_signature: params.winSparkleEdSignature,
            tauri_signature: params.tauriSignature,
            blockmap: params.blockmap ? 1 : 0,
            created_at: params.now,
            updated_at: params.now,
          })
          .execute(),
      );
    }),

  findByBuildAndChannel: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        selectReleases(db)
          .where("r.build_id", "=", params.buildId)
          .where("r.channel", "=", params.channel)
          .executeTakeFirst(),
      );
      return row === undefined ? null : toFeedEntry(row);
    }),

  findById: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        selectReleases(db).where("r.id", "=", params.id).executeTakeFirst(),
      );
      if (row === undefined) {
        return yield* new NotFound({ message: "Desktop release not found" });
      }
      return toFeedEntry(row);
    }),

  listByProject: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const { platform, channel, buildId } = params;
      const countRow = yield* Effect.promise(async () =>
        db
          .selectFrom("desktop_releases as r")
          .innerJoin("builds as b", "b.id", "r.build_id")
          .where((eb) =>
            eb.and(
              compactConditions([
                eb("r.project_id", "=", params.projectId),
                platform === undefined ? null : eb("b.platform", "=", platform),
                channel === undefined ? null : eb("r.channel", "=", channel),
                buildId === undefined ? null : eb("r.build_id", "=", buildId),
              ]),
            ),
          )
          .select((eb) => eb.fn.countAll<number>().as("count"))
          .executeTakeFirstOrThrow(),
      );
      const rows = yield* Effect.promise(async () =>
        newestFirst(
          selectReleases(db).where((eb) =>
            eb.and(
              compactConditions([
                eb("r.project_id", "=", params.projectId),
                platform === undefined ? null : eb("b.platform", "=", platform),
                channel === undefined ? null : eb("r.channel", "=", channel),
                buildId === undefined ? null : eb("r.build_id", "=", buildId),
              ]),
            ),
          ),
        )
          .limit(params.limit)
          .offset(params.offset)
          .execute(),
      );
      return { items: rows.map(toFeedEntry), total: countRow.count };
    }),

  update: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* Effect.promise(async () =>
        db
          .updateTable("desktop_releases")
          .set({
            updated_at: params.now,
            ...(params.halted === undefined ? {} : { halted: params.halted ? 1 : 0 }),
            ...(params.rolloutPercentage === undefined
              ? {}
              : { rollout_percentage: params.rolloutPercentage }),
            ...(params.phasedRolloutHours === undefined
              ? {}
              : { phased_rollout_hours: params.phasedRolloutHours }),
            ...(params.releaseNotes === undefined ? {} : { release_notes: params.releaseNotes }),
            ...(params.critical === undefined ? {} : { critical: params.critical ? 1 : 0 }),
            ...(params.sha512 === undefined ? {} : { sha512: params.sha512 }),
            ...(params.sparkleEdSignature === undefined
              ? {}
              : { sparkle_ed_signature: params.sparkleEdSignature }),
            ...(params.winSparkleEdSignature === undefined
              ? {}
              : { winsparkle_ed_signature: params.winSparkleEdSignature }),
            ...(params.tauriSignature === undefined
              ? {}
              : { tauri_signature: params.tauriSignature }),
            ...(params.blockmap === undefined ? {} : { blockmap: params.blockmap ? 1 : 0 }),
          })
          .where("id", "=", params.id)
          .execute(),
      );
    }),

  delete: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* Effect.promise(async () =>
        db.deleteFrom("desktop_releases").where("id", "=", params.id).execute(),
      );
    }),

  listFeed: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        newestFirst(
          selectReleases(db)
            .where("r.project_id", "=", params.projectId)
            .where("b.platform", "=", params.platform)
            .where("r.halted", "=", 0)
            .where((eb) =>
              params.channel === undefined ? eb.lit(true) : eb("r.channel", "=", params.channel),
            ),
        )
          .limit(params.limit)
          .execute(),
      );
      return rows.map(toFeedEntry);
    }),

  findFeedEntry: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        selectReleases(db)
          .where("r.id", "=", params.id)
          .where("r.project_id", "=", params.projectId)
          .where("b.platform", "=", params.platform)
          .where("r.halted", "=", 0)
          .executeTakeFirst(),
      );
      return row === undefined ? null : toFeedEntry(row);
    }),

  listBlockmapReleases: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        newestFirst(
          selectReleases(db)
            .where("r.project_id", "=", params.projectId)
            .where("b.platform", "=", params.platform)
            .where("b.app_version", "=", params.appVersion)
            .where("a.format", "=", params.format)
            .where("r.blockmap", "=", 1),
        )
          .limit(params.limit)
          .execute(),
      );
      return rows.map(toFeedEntry);
    }),
});
