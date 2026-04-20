CREATE TABLE "device_registration_requests" (
  "id"                  TEXT PRIMARY KEY,
  "organization_id"     TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "created_by_user_id"  TEXT NOT NULL,
  "device_name_hint"    TEXT,
  "device_class_hint"   TEXT CHECK ("device_class_hint" IS NULL OR "device_class_hint" IN ('IPHONE','IPAD','MAC','UNKNOWN')),
  "expires_at"          TEXT NOT NULL,
  "consumed_at"         TEXT,
  "consumed_device_id"  TEXT REFERENCES "devices"("id") ON DELETE SET NULL,
  "created_at"          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX "idx_drr_org_expires" ON "device_registration_requests"("organization_id", "expires_at");
CREATE INDEX "idx_drr_active" ON "device_registration_requests"("organization_id", "expires_at")
  WHERE "consumed_at" IS NULL;
