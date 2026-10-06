-- macOS Developer ID builds: widen the CHECKs on "builds" (platform 'macos',
-- distribution 'developer-id') and "build_artifacts" (formats 'dmg', 'zip',
-- 'pkg'). SQLite cannot alter a CHECK, so both tables are rebuilt.
--
-- "builds" has children: build_artifacts, build_debug_artifacts and
-- build_install_artifacts reference it ON DELETE CASCADE, submissions ON DELETE
-- SET NULL. DROP TABLE runs an implicit DELETE that fires those actions while
-- foreign keys are enforced (always, on D1), so dropping "builds" would erase
-- every artifact row and unlink every submission. Each child's rows are
-- stashed in a constraint-free copy first and restored after the swap; the
-- children's FK clauses name "builds" textually, so once the new table takes
-- that name they point at it.
--
-- Additive for clients: the new values only appear on rows a macOS-capable CLI
-- creates, and old CLIs never send them.

-- 1. Stash every child row that the drop would cascade over or unlink.
CREATE TABLE "_stash_build_artifacts" AS SELECT * FROM "build_artifacts";
CREATE TABLE "_stash_build_debug_artifacts" AS SELECT * FROM "build_debug_artifacts";
CREATE TABLE "_stash_build_install_artifacts" AS SELECT * FROM "build_install_artifacts";
CREATE TABLE "_stash_submission_builds" AS
  SELECT "id", "build_id" FROM "submissions" WHERE "build_id" IS NOT NULL;

-- 2. Rebuild "builds" with the widened CHECKs (column order matches the
--    existing table, including the two columns later migrations appended).
CREATE TABLE "builds_v2" (
  "id"               TEXT PRIMARY KEY,
  "project_id"       TEXT NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "platform"         TEXT NOT NULL CHECK ("platform" IN ('ios', 'android', 'macos')),
  "profile"          TEXT NOT NULL DEFAULT 'production',
  "distribution"     TEXT NOT NULL CHECK ("distribution" IN (
    'app-store', 'ad-hoc', 'development', 'enterprise',
    'simulator', 'play-store', 'direct', 'developer-id'
  )),
  "runtime_version"  TEXT,
  "app_version"      TEXT,
  "build_number"     TEXT,
  "bundle_id"        TEXT,
  "git_ref"          TEXT,
  "git_commit"       TEXT,
  "message"          TEXT,
  "metadata_json"    TEXT NOT NULL DEFAULT '{}',
  "created_at"       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "fingerprint_hash" TEXT,
  "git_dirty"        INTEGER NOT NULL DEFAULT 0
);

INSERT INTO "builds_v2"
  ("id", "project_id", "platform", "profile", "distribution", "runtime_version",
   "app_version", "build_number", "bundle_id", "git_ref", "git_commit", "message",
   "metadata_json", "created_at", "fingerprint_hash", "git_dirty")
SELECT
  "id", "project_id", "platform", "profile", "distribution", "runtime_version",
  "app_version", "build_number", "bundle_id", "git_ref", "git_commit", "message",
  "metadata_json", "created_at", "fingerprint_hash", "git_dirty"
FROM "builds";

DROP TABLE "builds";
ALTER TABLE "builds_v2" RENAME TO "builds";

CREATE INDEX "idx_builds_runtime" ON "builds"("project_id", "runtime_version");
CREATE INDEX "idx_builds_project"
  ON "builds" ("project_id", "created_at" DESC, "id" DESC);
CREATE INDEX "idx_builds_platform"
  ON "builds" ("project_id", "platform", "created_at" DESC, "id" DESC);
CREATE INDEX "idx_builds_fingerprint"
  ON "builds"("project_id", "fingerprint_hash") WHERE "fingerprint_hash" IS NOT NULL;

-- 3. Rebuild "build_artifacts" with the widened format CHECK (the drop above
--    already emptied it).
CREATE TABLE "build_artifacts_v2" (
  "build_id"     TEXT PRIMARY KEY REFERENCES "builds"("id") ON DELETE CASCADE,
  "r2_key"       TEXT NOT NULL,
  "format"       TEXT NOT NULL CHECK ("format" IN ('ipa', 'apk', 'aab', 'tar.gz', 'dmg', 'zip', 'pkg')),
  "content_type" TEXT NOT NULL DEFAULT 'application/octet-stream',
  "byte_size"    INTEGER NOT NULL,
  "sha256"       TEXT NOT NULL,
  "created_at"   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
DROP TABLE "build_artifacts";
ALTER TABLE "build_artifacts_v2" RENAME TO "build_artifacts";

-- 4. Restore the children.
INSERT INTO "build_artifacts"
  ("build_id", "r2_key", "format", "content_type", "byte_size", "sha256", "created_at")
SELECT "build_id", "r2_key", "format", "content_type", "byte_size", "sha256", "created_at"
FROM "_stash_build_artifacts";

INSERT INTO "build_debug_artifacts"
  ("build_id", "type", "r2_key", "content_type", "byte_size", "sha256", "created_at")
SELECT "build_id", "type", "r2_key", "content_type", "byte_size", "sha256", "created_at"
FROM "_stash_build_debug_artifacts";

INSERT INTO "build_install_artifacts"
  ("build_id", "r2_key", "content_type", "byte_size", "sha256", "created_at")
SELECT "build_id", "r2_key", "content_type", "byte_size", "sha256", "created_at"
FROM "_stash_build_install_artifacts";

UPDATE "submissions"
SET "build_id" = (
  SELECT "build_id" FROM "_stash_submission_builds" AS "s" WHERE "s"."id" = "submissions"."id"
)
WHERE "id" IN (SELECT "id" FROM "_stash_submission_builds");

DROP TABLE "_stash_build_artifacts";
DROP TABLE "_stash_build_debug_artifacts";
DROP TABLE "_stash_build_install_artifacts";
DROP TABLE "_stash_submission_builds";
