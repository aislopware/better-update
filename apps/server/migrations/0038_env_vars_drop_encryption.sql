-- Sensitive env vars are no longer encrypted server-side. They are stored as plaintext
-- and only hidden by default in the dashboard, with a reveal toggle. Existing rows whose
-- value lived in encrypted_value become unrecoverable; the row metadata (key, scope,
-- environments) is preserved so the user can re-enter the value.

ALTER TABLE "env_vars" DROP COLUMN "encrypted_value";
ALTER TABLE "env_vars" DROP COLUMN "key_version";
