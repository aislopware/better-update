-- Superadmin-gated user approval. The web app is in development and must not be
-- publicly usable: new users default to NOT approved and can only use the app
-- once a superadmin verifies them.
--
-- `approved` (0/1 — SQLite has no native boolean) defaults 0 so every existing
-- and future user is gated until explicitly approved. The remaining columns are
-- required by the Better Auth `admin` plugin, which adds a GLOBAL user role
-- (role = 'admin' marks the superadmin) plus ban bookkeeping and an
-- impersonation back-reference on the session.

ALTER TABLE "user" ADD COLUMN "role" TEXT;
ALTER TABLE "user" ADD COLUMN "banned" INTEGER;
ALTER TABLE "user" ADD COLUMN "ban_reason" TEXT;
ALTER TABLE "user" ADD COLUMN "ban_expires" DATE;
ALTER TABLE "user" ADD COLUMN "approved" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "session" ADD COLUMN "impersonated_by" TEXT;
