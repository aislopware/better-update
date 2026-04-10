-- Patches table for bundle diffing
CREATE TABLE "patches" (
  "old_asset_hash" TEXT NOT NULL,
  "new_asset_hash" TEXT NOT NULL,
  "byte_size" INTEGER NOT NULL,
  "r2_key" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY ("old_asset_hash", "new_asset_hash")
);

CREATE INDEX "idx_patches_new_asset_hash" ON "patches" ("new_asset_hash");
CREATE INDEX "idx_patches_created_at" ON "patches" ("created_at");
