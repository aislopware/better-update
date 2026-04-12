CREATE TABLE "credentials" (
    "id" TEXT PRIMARY KEY,
    "organization_id" TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
    "project_id" TEXT REFERENCES "projects"("id") ON DELETE SET NULL,
    "platform" TEXT NOT NULL CHECK ("platform" IN ('ios', 'android')),
    "type" TEXT NOT NULL CHECK ("type" IN (
        'distribution-certificate', 'provisioning-profile', 'push-key',
        'keystore', 'play-service-account'
    )),
    "name" TEXT NOT NULL,
    "distribution" TEXT CHECK ("distribution" IN ('ad-hoc', 'app-store', 'development', 'enterprise', 'play-store', 'direct')),
    "is_active" INTEGER NOT NULL DEFAULT 0,
    "r2_key" TEXT NOT NULL,
    "encrypted_dek" TEXT NOT NULL,
    "key_version" INTEGER NOT NULL DEFAULT 1,
    "encrypted_password" TEXT,
    "encrypted_key_alias" TEXT,
    "encrypted_key_password" TEXT,
    "metadata_json" TEXT NOT NULL DEFAULT '{}',
    "expires_at" TEXT,
    "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX "idx_credentials_org" ON "credentials"("organization_id", "platform");
CREATE INDEX "idx_credentials_project" ON "credentials"("project_id", "platform") WHERE "project_id" IS NOT NULL;
CREATE UNIQUE INDEX "idx_credentials_active" ON "credentials"("organization_id", COALESCE("project_id", ''), "platform", "type", COALESCE("distribution", '')) WHERE "is_active" = 1;
