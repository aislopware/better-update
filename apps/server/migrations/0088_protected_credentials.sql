-- Protected-credential toggles (docs/specs/authz/GITLAB-RBAC-SPEC.md §3b).
-- Apple: the flag lives ONLY on the team — every child credential (dist certs,
-- push keys/certs, provisioning profiles, pass-type/pay certs, ASC API keys)
-- inherits it structurally; there is no per-credential column, so children can
-- never diverge from the team. Team-less Apple credentials are ALWAYS
-- protected (spec §2a-3, enforced in code — no flag needed).
ALTER TABLE "apple_teams" ADD COLUMN "is_protected" INTEGER NOT NULL DEFAULT 0;

-- Android/Google org-shared secrets have no parent: per-row toggles.
ALTER TABLE "google_service_account_keys" ADD COLUMN "is_protected" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "android_upload_keystores" ADD COLUMN "is_protected" INTEGER NOT NULL DEFAULT 0;
