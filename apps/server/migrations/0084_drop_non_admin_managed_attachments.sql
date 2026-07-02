-- Managed policies are reduced to `managed:admin` ONLY (capabilities and
-- parameterized project roles removed — docs/specs/authz/ROLES-CAPABILITIES-SPEC.md
-- header note). Drop every other managed attachment/invitation grant so no
-- inert rows linger; fine-grained access is granted via custom policies.
DELETE FROM "policy_attachment"
  WHERE "policy_id" LIKE 'managed:%' AND "policy_id" != 'managed:admin';

DELETE FROM "invitation_grant"
  WHERE "policy_id" LIKE 'managed:%' AND "policy_id" != 'managed:admin';
