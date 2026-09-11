import type { Kysely } from "kysely";

import type { DB } from "../db/schema";
import type { ArtifactFormat, BuildWithArtifactModel, Distribution, Platform } from "../models";

/**
 * Base build projection: every stored column plus the LEFT-joined artifact
 * columns aliased `a_*` and the LEFT-joined install-artifact (universal APK)
 * columns aliased `i_*`. Shared by every read so the `toBuildWithArtifact`
 * mapper always sees an identical row shape. The domain-narrowed columns
 * (`platform`, `distribution`, `a_format`) and the non-null `id` are `$castTo`'d
 * from their wider schema types so the inferred row matches the mapper input.
 * Pure query builder — the caller executes it.
 */
export const selectBuildsWithArtifact = (db: Kysely<DB>) =>
  db
    .selectFrom("builds as b")
    .leftJoin("build_artifacts as a", "a.build_id", "b.id")
    .leftJoin("build_install_artifacts as i", "i.build_id", "b.id")
    .select((eb) => [
      eb.ref("b.id").$castTo<string>().as("id"),
      "b.project_id",
      eb.ref("b.platform").$castTo<Platform>().as("platform"),
      "b.profile",
      eb.ref("b.distribution").$castTo<Distribution>().as("distribution"),
      "b.runtime_version",
      "b.app_version",
      "b.build_number",
      "b.bundle_id",
      "b.git_ref",
      "b.git_commit",
      "b.git_dirty",
      "b.message",
      "b.metadata_json",
      "b.fingerprint_hash",
      "b.created_at",
      eb.ref("a.r2_key").as("a_r2_key"),
      eb.ref("a.format").$castTo<ArtifactFormat | null>().as("a_format"),
      eb.ref("a.content_type").as("a_content_type"),
      eb.ref("a.byte_size").as("a_byte_size"),
      eb.ref("a.sha256").as("a_sha256"),
      eb.ref("i.r2_key").as("i_r2_key"),
      eb.ref("i.content_type").as("i_content_type"),
      eb.ref("i.byte_size").as("i_byte_size"),
      eb.ref("i.sha256").as("i_sha256"),
      eb.ref("i.created_at").as("i_created_at"),
    ]);

interface BuildWithArtifactRow {
  id: string;
  project_id: string;
  platform: Platform;
  profile: string;
  distribution: Distribution;
  runtime_version: string | null;
  app_version: string | null;
  build_number: string | null;
  bundle_id: string | null;
  git_ref: string | null;
  git_commit: string | null;
  git_dirty: number;
  message: string | null;
  metadata_json: string;
  fingerprint_hash: string | null;
  created_at: string;
  a_r2_key: string | null;
  a_format: ArtifactFormat | null;
  a_content_type: string | null;
  a_byte_size: number | null;
  a_sha256: string | null;
  i_r2_key: string | null;
  i_content_type: string | null;
  i_byte_size: number | null;
  i_sha256: string | null;
  i_created_at: string | null;
}

export const toBuildWithArtifact = (row: BuildWithArtifactRow): BuildWithArtifactModel => ({
  id: row.id,
  projectId: row.project_id,
  platform: row.platform,
  profile: row.profile,
  distribution: row.distribution,
  runtimeVersion: row.runtime_version,
  appVersion: row.app_version,
  buildNumber: row.build_number,
  bundleId: row.bundle_id,
  gitRef: row.git_ref,
  gitCommit: row.git_commit,
  gitDirty: row.git_dirty === 1,
  message: row.message,
  metadataJson: row.metadata_json,
  fingerprintHash: row.fingerprint_hash,
  createdAt: row.created_at,
  artifact:
    row.a_r2_key && row.a_format && row.a_sha256 && row.a_byte_size !== null
      ? {
          r2Key: row.a_r2_key,
          format: row.a_format,
          contentType: row.a_content_type ?? "application/octet-stream",
          byteSize: row.a_byte_size,
          sha256: row.a_sha256,
        }
      : null,
  installArtifact:
    row.i_r2_key && row.i_sha256 && row.i_byte_size !== null && row.i_created_at
      ? {
          r2Key: row.i_r2_key,
          contentType: row.i_content_type ?? "application/vnd.android.package-archive",
          byteSize: row.i_byte_size,
          sha256: row.i_sha256,
          createdAt: row.i_created_at,
        }
      : null,
});
