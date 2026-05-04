-- Recreate devices indexes with id tie-breaker for stable cursor pagination.
-- Cursor encodes (created_at, id); query uses (created_at, id) keyset comparison
-- and ORDER BY created_at DESC, id DESC. Trailing id keeps the index covering.

DROP INDEX IF EXISTS "idx_devices_org_created";

CREATE INDEX "idx_devices_org_created"
  ON "devices" ("organization_id", "created_at" DESC, "id" DESC);

CREATE INDEX "idx_devices_org_class_created"
  ON "devices" ("organization_id", "device_class", "created_at" DESC, "id" DESC);

CREATE INDEX "idx_devices_org_team_created"
  ON "devices" ("organization_id", "apple_team_id", "created_at" DESC, "id" DESC);
