CREATE TABLE "devices" (
  "id"                      TEXT PRIMARY KEY,
  "organization_id"         TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "identifier"              TEXT NOT NULL,
  "name"                    TEXT NOT NULL,
  "model"                   TEXT,
  "device_class"            TEXT NOT NULL CHECK ("device_class" IN ('IPHONE','IPAD','MAC','UNKNOWN')),
  "enabled"                 INTEGER NOT NULL DEFAULT 1,
  "apple_device_portal_id"  TEXT,
  "created_at"              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at"              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX "idx_devices_org_identifier" ON "devices"("organization_id", "identifier");
CREATE INDEX "idx_devices_org_created" ON "devices"("organization_id", "created_at" DESC);
