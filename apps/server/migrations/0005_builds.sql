CREATE TABLE "builds" (
    "id" TEXT PRIMARY KEY,
    "project_id" TEXT NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "platform" TEXT NOT NULL CHECK ("platform" IN ('ios', 'android')),
    "profile" TEXT NOT NULL DEFAULT 'production',
    "distribution" TEXT NOT NULL CHECK ("distribution" IN (
        'app-store', 'ad-hoc', 'development', 'enterprise',
        'simulator', 'play-store', 'direct'
    )),
    "runtime_version" TEXT,
    "app_version" TEXT,
    "build_number" TEXT,
    "bundle_id" TEXT,
    "git_ref" TEXT,
    "git_commit" TEXT,
    "message" TEXT,
    "metadata_json" TEXT NOT NULL DEFAULT '{}',
    "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE "build_artifacts" (
    "build_id" TEXT PRIMARY KEY REFERENCES "builds"("id") ON DELETE CASCADE,
    "r2_key" TEXT NOT NULL,
    "format" TEXT NOT NULL CHECK ("format" IN ('ipa', 'apk', 'aab', 'tar.gz')),
    "content_type" TEXT NOT NULL DEFAULT 'application/octet-stream',
    "byte_size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX "idx_builds_project" ON "builds"("project_id", "created_at" DESC);
CREATE INDEX "idx_builds_platform" ON "builds"("project_id", "platform", "created_at" DESC);
CREATE INDEX "idx_builds_runtime" ON "builds"("project_id", "runtime_version");
