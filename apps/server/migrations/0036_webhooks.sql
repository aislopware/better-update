-- Webhook subscriptions: deliver event notifications to user-configured HTTPS endpoints.
-- Minimum viable shape — fire-once HMAC-signed POST on `update.published` and `build.completed`.
-- Retry/queue infrastructure deferred to a follow-up migration.

CREATE TABLE "webhooks" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organization_id" TEXT NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  "project_id" TEXT REFERENCES "projects" ("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  -- HMAC secret used to sign the X-Webhook-Signature header. Stored as plaintext
  -- because a webhook secret is functionally a shared password — the user can
  -- rotate it via the dashboard. Encrypt-at-rest can come later via vault.
  "secret" TEXT NOT NULL,
  -- JSON array of event names this webhook subscribes to.
  -- Example: '["update.published","build.completed"]'.
  "events" TEXT NOT NULL DEFAULT '[]',
  "enabled" INTEGER NOT NULL DEFAULT 1,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL
);

CREATE INDEX "webhooks_org_id_idx" ON "webhooks" ("organization_id");
CREATE INDEX "webhooks_project_id_idx" ON "webhooks" ("project_id");
