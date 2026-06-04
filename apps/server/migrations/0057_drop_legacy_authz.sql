-- Replaced by the IAM policy/group model (docs/specs/authz/POLICY-GROUPS-SPEC.md).
-- Prod has zero real users; no data migration. The organization() plugin no longer
-- registers dynamicAccessControl nor the organizationRole model (apps/server/src/auth.ts).
DROP TABLE IF EXISTS "environment_grant";
DROP TABLE IF EXISTS "organization_role";
