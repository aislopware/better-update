CREATE TABLE "android_application_identifiers" (
  "id"              TEXT PRIMARY KEY,
  "organization_id" TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "project_id"      TEXT NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "package_name"    TEXT NOT NULL,
  "created_at"      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at"      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX "idx_android_app_id_unique" ON "android_application_identifiers"("project_id", "package_name");
CREATE INDEX "idx_android_app_id_org" ON "android_application_identifiers"("organization_id");
CREATE INDEX "idx_android_app_id_project" ON "android_application_identifiers"("project_id");
