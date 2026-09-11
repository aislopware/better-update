-- Device-installable companion of an Android App Bundle build. Google Play
-- takes the .aab, but a phone cannot install one — so the CLI builds a
-- universal APK from the same Gradle run, signed with the same upload key,
-- and attaches it here. At most one per build; lives beside the primary
-- artifact in the private builds bucket and is served through the same signed
-- install-link token as the primary artifact.
CREATE TABLE "build_install_artifacts" (
  "build_id"     TEXT NOT NULL PRIMARY KEY REFERENCES "builds" ("id") ON DELETE CASCADE,
  "r2_key"       TEXT NOT NULL,
  "content_type" TEXT NOT NULL DEFAULT 'application/vnd.android.package-archive',
  "byte_size"    INTEGER NOT NULL,
  "sha256"       TEXT NOT NULL,
  "created_at"   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
