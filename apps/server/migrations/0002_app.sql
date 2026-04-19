-- Core application tables
-- Based on: docs/specs/server/02-data-model.md

CREATE TABLE "projects" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organization_id" TEXT NOT NULL REFERENCES "organization" ("id"),
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  UNIQUE ("organization_id", "slug")
);

CREATE TABLE "branches" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "project_id" TEXT NOT NULL REFERENCES "projects" ("id"),
  "name" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  UNIQUE ("project_id", "name")
);

CREATE TABLE "channels" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "project_id" TEXT NOT NULL REFERENCES "projects" ("id"),
  "name" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL REFERENCES "branches" ("id"),
  "branch_mapping_json" TEXT,
  "cache_version" INTEGER NOT NULL DEFAULT 0,
  "is_paused" INTEGER NOT NULL DEFAULT 0,
  "created_at" TEXT NOT NULL,
  UNIQUE ("project_id", "name")
);

CREATE TABLE "updates" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "branch_id" TEXT NOT NULL REFERENCES "branches" ("id"),
  "runtime_version" TEXT NOT NULL,
  "platform" TEXT NOT NULL CHECK ("platform" IN ('ios', 'android')),
  "message" TEXT NOT NULL,
  "metadata_json" TEXT NOT NULL DEFAULT '{}',
  "extra_json" TEXT,
  "group_id" TEXT NOT NULL,
  "rollout_percentage" INTEGER NOT NULL DEFAULT 100,
  "is_rollback" INTEGER NOT NULL DEFAULT 0,
  "signature" TEXT,
  "certificate_chain" TEXT,
  "manifest_body" TEXT,
  "directive_body" TEXT,
  "created_at" TEXT NOT NULL
);

CREATE TABLE "assets" (
  "hash" TEXT NOT NULL PRIMARY KEY,
  "content_type" TEXT NOT NULL,
  "file_ext" TEXT NOT NULL,
  "byte_size" INTEGER NOT NULL,
  "r2_key" TEXT NOT NULL,
  "created_at" TEXT NOT NULL
);

CREATE TABLE "update_assets" (
  "update_id" TEXT NOT NULL REFERENCES "updates" ("id"),
  "asset_key" TEXT NOT NULL,
  "asset_hash" TEXT NOT NULL REFERENCES "assets" ("hash"),
  "is_launch" INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY ("update_id", "asset_key")
);

-- Indexes
CREATE INDEX "idx_projects_org" ON "projects" ("organization_id");
CREATE INDEX "idx_channels_branch_project" ON "channels" ("branch_id", "project_id");
CREATE INDEX "idx_updates_resolution" ON "updates" ("branch_id", "platform", "runtime_version", "created_at" DESC, "id" DESC);
CREATE INDEX "idx_updates_group" ON "updates" ("group_id");
CREATE INDEX "idx_update_assets_update" ON "update_assets" ("update_id");
CREATE UNIQUE INDEX "idx_update_assets_launch" ON "update_assets" ("update_id") WHERE "is_launch" = 1;
