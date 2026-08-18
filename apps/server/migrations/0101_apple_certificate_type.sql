-- Record which kind of Apple signing certificate each stored .p12 is.
--
-- The table was built when the only certificate the CLI could store was an iOS
-- distribution certificate. macOS Developer ID support then reused the same
-- table and told the two apart by a heuristic: a Developer ID certificate is the
-- only kind whose X.509 subject carries a UID, so "developer_id_identifier IS
-- NOT NULL" stood in for a type. That heuristic only ever held for certificates
-- the CLI *generated* (it read the UID out of Apple's response); a .p12 exported
-- from Keychain and uploaded landed with a NULL UID and became invisible to
-- `macos sign`. It also cannot express the other macOS kinds at all — Developer
-- ID Installer, Mac App Store application and installer certificates all look
-- identical to it.
--
-- Backfill reproduces exactly what the heuristic decided, so no stored
-- certificate changes meaning: rows with a UID become DEVELOPER_ID_APPLICATION,
-- everything else keeps being read as an iOS distribution certificate. Rows
-- uploaded from now on carry the type parsed from the certificate subject.
--
-- The DEFAULT is what makes this addable in place (SQLite cannot add a NOT NULL
-- column without one) and it is also the compatibility path: a CLI predating the
-- upload field sends no type, and the handler falls back to the same UID
-- heuristic before writing.
ALTER TABLE "apple_distribution_certificates"
  ADD COLUMN "certificate_type" TEXT NOT NULL DEFAULT 'IOS_DISTRIBUTION';

UPDATE "apple_distribution_certificates"
SET "certificate_type" = 'DEVELOPER_ID_APPLICATION'
WHERE "developer_id_identifier" IS NOT NULL;
