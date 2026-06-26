-- The CLI requires a `--name` at `credentials upload`, but keystore rows only
-- ever stored the internal key alias — which collides across white-label apps
-- that reuse the same alias (e.g. "jmango"). Persist the user-supplied label so
-- `credentials list` can disambiguate identical-alias keystores. Nullable so
-- pre-existing rows (and the keytool-`generate` flow) keep working.
ALTER TABLE "android_upload_keystores" ADD COLUMN "name" TEXT;
