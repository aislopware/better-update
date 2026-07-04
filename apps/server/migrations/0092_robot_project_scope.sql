-- Robot accounts become PROJECT-scoped (GITLAB-RBAC-SPEC §1b, v2): one robot
-- = one project + one project role, GitLab project-access-token shape.
-- org_role (0089) is dropped; robot permissions never come from
-- project_member rows anymore. Table recreate because 0089's inline CHECK
-- blocks DROP COLUMN in SQLite.
--
-- Legacy rows (all pre-v2 robots) keep project_id NULL: they STOP
-- authenticating (verifyBearer requires a project) but stay listed so their
-- vault access can be revoked through the normal flow, then re-created
-- per-project (owner decision 2026-07-03, authz compat waiver).
CREATE TABLE "robot_account_v2" (
  "id"                     TEXT NOT NULL PRIMARY KEY,
  "organization_id"        TEXT NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  -- NULL = legacy pre-v2 robot: visible + revocable, never authenticates.
  "project_id"             TEXT REFERENCES "projects" ("id") ON DELETE CASCADE,
  "project_role"           TEXT CHECK ("project_role" IN ('maintainer', 'developer', 'reporter')),
  "name"                   TEXT NOT NULL,
  "bearer_key_hash"        TEXT,
  "bearer_start"           TEXT,
  "user_encryption_key_id" TEXT REFERENCES "user_encryption_keys" ("id") ON DELETE SET NULL,
  "created_at"             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "revoked_at"             TEXT,
  -- project + role travel together: both set (v2) or both NULL (legacy).
  CHECK (("project_id" IS NULL) = ("project_role" IS NULL))
);

INSERT INTO "robot_account_v2"
  ("id", "organization_id", "project_id", "project_role", "name",
   "bearer_key_hash", "bearer_start", "user_encryption_key_id", "created_at", "revoked_at")
SELECT
  "id", "organization_id", NULL, NULL, "name",
  "bearer_key_hash", "bearer_start", "user_encryption_key_id", "created_at", "revoked_at"
FROM "robot_account";

DROP TABLE "robot_account";
ALTER TABLE "robot_account_v2" RENAME TO "robot_account";

CREATE UNIQUE INDEX "idx_robot_account_bearer_hash"
  ON "robot_account" ("bearer_key_hash") WHERE "bearer_key_hash" IS NOT NULL;
CREATE INDEX "idx_robot_account_org" ON "robot_account" ("organization_id");
CREATE INDEX "idx_robot_account_project"
  ON "robot_account" ("project_id") WHERE "project_id" IS NOT NULL;
CREATE UNIQUE INDEX "idx_robot_account_user_encryption_key"
  ON "robot_account" ("user_encryption_key_id") WHERE "user_encryption_key_id" IS NOT NULL;

-- v1 multi-project robot grants are dead: robot rank now lives on the robot
-- row itself. Humans keep their project_member rows untouched.
DELETE FROM "project_member" WHERE "principal_type" = 'robot';
