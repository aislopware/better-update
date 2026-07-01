-- Track whether a submission's post-upload store metadata was fully applied.
--
-- A submission row still means "a client-side binary upload succeeded", but iOS
-- TestFlight config (the "What to Test" text + beta groups) runs as a separate
-- step that can fail on its own — e.g. App Store Connect rejecting the changelog.
-- When it does, the binary is already uploaded, so the CLI now records the
-- submission as metadata-incomplete instead of leaving the dashboard blank, then
-- surfaces the error. A re-run (which skips the already-uploaded binary and just
-- re-applies metadata) updates the same row, keyed on build_version.
--
-- Both columns are additive with backward-compatible defaults: every pre-existing
-- row is a completed submission (metadata_complete = 1) with no recorded build
-- number (build_version = NULL), so mixed-version clients keep working.

ALTER TABLE "submissions" ADD COLUMN "metadata_complete" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "submissions" ADD COLUMN "build_version" TEXT;

-- Idempotent re-run lookup: newest incomplete iOS submission for a build number.
CREATE INDEX "idx_submissions_build_version" ON "submissions"(
  "project_id", "platform", "build_version", "created_at" DESC
);
