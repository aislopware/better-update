CREATE TABLE "patches" (
  "old_asset_hash" TEXT NOT NULL REFERENCES "assets" ("hash"),
  "new_asset_hash" TEXT NOT NULL REFERENCES "assets" ("hash"),
  "byte_size" INTEGER NOT NULL,
  "r2_key" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY ("old_asset_hash", "new_asset_hash")
);

CREATE INDEX "idx_patches_new_asset" ON "patches" ("new_asset_hash");
CREATE INDEX "idx_patches_created_at" ON "patches" ("created_at");
