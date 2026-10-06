-- Desktop releases: a macOS Developer ID build published to an update-feed
-- channel (Sparkle appcast, electron-updater `<channel>-mac.yml`, Tauri
-- `<channel>-tauri.json`). Feeds list
-- only releases, so uploading a build never ships it by itself.
--
-- A child of "builds" (ON DELETE CASCADE): any future rebuild of "builds" must
-- stash and restore these rows alongside the ones migration 0105 stashes.
CREATE TABLE "desktop_releases" (
  "id"                   TEXT PRIMARY KEY,
  "project_id"           TEXT NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "build_id"             TEXT NOT NULL REFERENCES "builds"("id") ON DELETE CASCADE,
  "channel"              TEXT NOT NULL,
  "release_notes"        TEXT,
  "critical"             INTEGER NOT NULL DEFAULT 0 CHECK ("critical" IN (0, 1)),
  "rollout_percentage"   INTEGER NOT NULL DEFAULT 100
                         CHECK ("rollout_percentage" BETWEEN 1 AND 100),
  "halted"               INTEGER NOT NULL DEFAULT 0 CHECK ("halted" IN (0, 1)),
  -- Sparkle's own phased rollout (`sparkle:phasedRolloutInterval`): a seventh
  -- of clients more every this many hours after the release. NULL = all at once.
  "phased_rollout_hours" INTEGER
                         CHECK ("phased_rollout_hours" BETWEEN 1 AND 720),
  -- Base64 SHA-512 of the artifact (electron-updater) and Ed25519 signature
  -- (Sparkle), both computed by the CLI over the stored bytes.
  "sha512"               TEXT NOT NULL,
  "sparkle_ed_signature" TEXT,
  -- Base64 minisign signature box for the Tauri updater (`.app.tar.gz` only).
  "tauri_signature"      TEXT,
  -- Whether the CLI uploaded electron-updater's blockmap of the `.zip`; it is
  -- stored next to the build's artifact as `<artifact key>.blockmap`.
  "blockmap"             INTEGER NOT NULL DEFAULT 0 CHECK ("blockmap" IN (0, 1)),
  "created_at"           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "updated_at"           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- One release of a build per channel; re-releasing updates it.
CREATE UNIQUE INDEX "idx_desktop_releases_build_channel"
  ON "desktop_releases" ("build_id", "channel");
-- Feed reads: newest releases of a project (optionally one channel).
CREATE INDEX "idx_desktop_releases_feed"
  ON "desktop_releases" ("project_id", "channel", "created_at" DESC, "id" DESC);
CREATE INDEX "idx_desktop_releases_project"
  ON "desktop_releases" ("project_id", "created_at" DESC, "id" DESC);
