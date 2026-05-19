import type { ArtifactFormat, BuildWithArtifactModel, Distribution, Platform } from "../models";

export interface BuildWithArtifactRow {
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
}

export const BUILD_WITH_ARTIFACT_COLUMNS = `b."id", b."project_id", b."platform", b."profile", b."distribution", b."runtime_version", b."app_version", b."build_number", b."bundle_id", b."git_ref", b."git_commit", b."git_dirty", b."message", b."metadata_json", b."fingerprint_hash", b."created_at", a."r2_key" AS "a_r2_key", a."format" AS "a_format", a."content_type" AS "a_content_type", a."byte_size" AS "a_byte_size", a."sha256" AS "a_sha256"`;

export const BUILD_WITH_ARTIFACT_JOIN = `FROM "builds" b LEFT JOIN "build_artifacts" a ON a."build_id" = b."id"`;

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
});
