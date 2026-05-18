-- Enforce one credential group per (app identifier, name) so the CLI can
-- resolve a deterministic group by its build profile name.
CREATE UNIQUE INDEX "idx_android_build_creds_app_name"
  ON "android_build_credentials"("android_application_identifier_id", "name");
