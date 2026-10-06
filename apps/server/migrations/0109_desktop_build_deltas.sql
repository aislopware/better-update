-- Sparkle binary deltas: a patch that turns an older macOS app bundle into a
-- build's bundle, so a Sparkle client running that older version downloads
-- the changed files instead of the whole archive. The CLI makes them with
-- Sparkle's BinaryDelta when it releases a build, signs them with the
-- release's EdDSA key and uploads them beside the artifact; the appcast lists
-- a build's deltas in its item's <sparkle:deltas>.
--
-- A delta belongs to the build it produces, not to a release: the same build
-- released to two channels serves the same deltas. It is keyed by the version
-- it patches from (Sparkle's `deltaFrom`, the old app's CFBundleVersion),
-- which is all a client matches on; the build it was made from may be deleted
-- later without making the delta less useful.
--
-- A CASCADE child of "builds": any future rebuild of "builds" must stash and
-- restore these rows alongside the ones migration 0108 stashes.
--
-- Additive for clients: only a delta-capable CLI writes rows, and appcasts
-- without deltas are what older servers served.
CREATE TABLE "desktop_build_deltas" (
  "id"                      TEXT PRIMARY KEY,
  "build_id"                TEXT NOT NULL REFERENCES "builds"("id") ON DELETE CASCADE,
  -- The old bundle's CFBundleVersion (`sparkle:deltaFrom`).
  "delta_from"              TEXT NOT NULL,
  "r2_key"                  TEXT NOT NULL,
  "byte_size"               INTEGER NOT NULL CHECK ("byte_size" >= 0),
  "sha256"                  TEXT NOT NULL,
  -- Base64 Ed25519 signature of the delta file (`sparkle:edSignature`).
  "ed_signature"            TEXT NOT NULL,
  -- The old bundle's Sparkle framework executable size and its non-English
  -- localizations (`sparkle:deltaFromSparkleExecutableSize` /
  -- `sparkle:deltaFromSparkleLocales`): Sparkle skips a delta whose old
  -- framework differs from the one the client runs (a stripped framework).
  "sparkle_executable_size" INTEGER,
  "sparkle_locales"         TEXT,
  "created_at"              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- One delta per old version; regenerating one replaces it.
CREATE UNIQUE INDEX "idx_desktop_build_deltas_build_from"
  ON "desktop_build_deltas" ("build_id", "delta_from");
