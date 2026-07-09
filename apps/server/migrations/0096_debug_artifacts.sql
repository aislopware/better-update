-- Debug artifacts for crash symbolication. Native builds attach up to one
-- artifact per type (iOS dSYM zip, embedded JS bundle sourcemap, Android R8
-- mapping.txt, NDK native-debug-symbols.zip); OTA publishes attach one JS
-- sourcemap per update. Stored privately in the builds bucket (NOT the public
-- assets CDN — sourcemaps reveal original source) and downloaded on demand via
-- short-lived presigned GET URLs when a crash needs symbolication.
CREATE TABLE "build_debug_artifacts" (
  "build_id"     TEXT NOT NULL REFERENCES "builds" ("id") ON DELETE CASCADE,
  "type"         TEXT NOT NULL CHECK ("type" IN
    ('dsym', 'js-sourcemap', 'proguard-mapping', 'native-symbols')),
  "r2_key"       TEXT NOT NULL,
  "content_type" TEXT NOT NULL DEFAULT 'application/octet-stream',
  "byte_size"    INTEGER NOT NULL,
  "sha256"       TEXT NOT NULL,
  "created_at"   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY ("build_id", "type")
);

CREATE TABLE "update_sourcemaps" (
  "update_id"  TEXT NOT NULL PRIMARY KEY REFERENCES "updates" ("id") ON DELETE CASCADE,
  "r2_key"     TEXT NOT NULL,
  "byte_size"  INTEGER NOT NULL,
  "sha256"     TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
