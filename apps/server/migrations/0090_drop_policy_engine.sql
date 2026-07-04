-- GitLab-style RBAC cleanup (docs/specs/authz/GITLAB-RBAC-SPEC.md §4a, final
-- step): the policy/group engine is gone — access is project_member rows +
-- member.role / robot_account.org_role, evaluated by the static matrix in
-- auth/role-matrix.ts. The backfills in 0086/0089 already consumed
-- policy_attachment (managed:admin holders → admin role), so these tables are
-- unread by any code path. Owner decision 2026-07-03: no authz backward
-- compatibility — drops are acceptable.
DROP TABLE IF EXISTS "policy_attachment";
DROP TABLE IF EXISTS "iam_group_membership";
DROP TABLE IF EXISTS "iam_group";
DROP TABLE IF EXISTS "policy";
DROP TABLE IF EXISTS "invitation_grant";
