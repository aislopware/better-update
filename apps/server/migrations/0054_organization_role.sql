-- Dynamic Access Control role table (better-auth `organization` plugin,
-- dynamicAccessControl.enabled). One row = one custom role for one org.
-- `permission` is a JSON-encoded Record<string, string[]> (resource -> actions).
-- See docs/specs/authz/recon/betterauth-ac-api.md section 4.

CREATE TABLE "organization_role" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "organization_id" TEXT NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  "role"            TEXT NOT NULL,
  "permission"      TEXT NOT NULL,
  "created_at"      DATE NOT NULL,
  "updated_at"      DATE
);

CREATE INDEX "organization_role_organization_id_idx"
  ON "organization_role" ("organization_id");

CREATE INDEX "organization_role_role_idx"
  ON "organization_role" ("role");

CREATE UNIQUE INDEX "organization_role_org_name_idx"
  ON "organization_role" ("organization_id", "role");
