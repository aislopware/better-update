-- Add content_checksum column for content-type-namespaced hashing.
-- hash (PK) becomes SHA-256(contentType + '\0' + SHA-256_hex(fileBytes)) — for dedup.
-- content_checksum stores SHA-256(fileBytes) — for R2 upload verification.
-- Backfill: existing rows used raw file hashes, so content_checksum = hash.
ALTER TABLE "assets" ADD COLUMN "content_checksum" TEXT NOT NULL DEFAULT '';
UPDATE "assets" SET "content_checksum" = "hash" WHERE "content_checksum" = '';
