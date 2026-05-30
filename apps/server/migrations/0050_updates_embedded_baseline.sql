-- Mark an update as the embedded baseline for its (branch, runtime_version,
-- platform). The client sends this update's id as `expo-embedded-update-id`, so
-- the bundle route can resolve a first-launch bsdiff patch against the bundle
-- shipped inside the binary. Exactly one baseline may exist per
-- (branch, runtime_version, platform); the partial unique index enforces it and
-- publish-coordination clears the prior baseline before inserting a new one.

ALTER TABLE "updates" ADD COLUMN "is_embedded" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "idx_updates_embedded_baseline"
  ON "updates"("branch_id", "runtime_version", "platform") WHERE "is_embedded" = 1;
