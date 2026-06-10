-- Bind the org-membership lifecycle to the vault-recipient lifecycle. When a
-- member is removed (or, later, loses vault access via a downgrade) the server
-- drops their device wrap out-of-band — but the departed member's CACHED vault
-- key still matches the live vault until it is rotated. `rotation_pending` marks
-- that "a recipient was dropped; the live key is considered compromised and must
-- be rotated". While set, credential reads (getWrap + build-credentials.resolve)
-- fail closed with 409; a successful `rotate` clears it. See
-- docs/specs/build/10-vault-lifecycle-revocation.md §3.
ALTER TABLE "org_vaults" ADD COLUMN "rotation_pending" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "org_vaults" ADD COLUMN "rotation_pending_since" TEXT;
ALTER TABLE "org_vaults" ADD COLUMN "rotation_pending_reason" TEXT;
