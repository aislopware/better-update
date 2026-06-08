-- Store the service-account OAuth2 client_id (the numeric account ID, e.g.
-- 109516608069988386879) extracted client-side at upload, so the dashboard can
-- show it under the client email (EAS parity). Unlike keystore_type there is no
-- safe backfill — client_id is unique per account and was never captured before,
-- so existing rows stay NULL and render as "—" until re-uploaded via the CLI.
ALTER TABLE "google_service_account_keys" ADD COLUMN "client_id" TEXT;
