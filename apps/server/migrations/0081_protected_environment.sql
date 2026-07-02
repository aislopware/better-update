-- Protected environments (docs/specs/authz/ROLES-CAPABILITIES-SPEC.md §2d).
-- Presence of a row = protected. Works for built-in (virtual) and custom
-- environment names alike. Unprotecting deletes the row.
CREATE TABLE "protected_environment" (
  "organization_id" TEXT NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  "environment"     TEXT NOT NULL,
  "created_at"      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY ("organization_id", "environment")
);

-- Default: production is protected everywhere.
INSERT INTO "protected_environment" ("organization_id", "environment")
  SELECT "id", 'production' FROM "organization";
