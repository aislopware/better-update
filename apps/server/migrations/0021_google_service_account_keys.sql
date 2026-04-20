CREATE TABLE "google_service_account_keys" (
  "id"                  TEXT PRIMARY KEY,
  "organization_id"     TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "client_email"        TEXT NOT NULL,
  "private_key_id"      TEXT NOT NULL,
  "google_project_id"   TEXT NOT NULL,
  "r2_key"              TEXT NOT NULL,
  "encrypted_dek"       TEXT NOT NULL,
  "dek_key_version"     INTEGER NOT NULL,
  "created_at"          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at"          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX "idx_gsak_org_pkid" ON "google_service_account_keys"("organization_id", "private_key_id");
CREATE INDEX "idx_gsak_org" ON "google_service_account_keys"("organization_id");
