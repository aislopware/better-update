-- Backfill the web env-vault step-up audit action from the jargon `vault.web.step-up`
-- to the clearer `vault.web.unlock` (handlers/web-vault.ts). Data-only: historical
-- rows read consistently with newly written ones. `action` is a free string with no
-- constraint/enum to update, and the web audit view maps both strings to one label,
-- so this is cosmetic-safe and idempotent (the WHERE no-ops once every row is
-- migrated). Additive — no schema change; prod has real users.
UPDATE "audit_logs" SET "action" = 'vault.web.unlock' WHERE "action" = 'vault.web.step-up';
