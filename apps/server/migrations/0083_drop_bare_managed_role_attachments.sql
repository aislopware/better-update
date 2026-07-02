-- Bare managed role ids are REMOVED from the grammar (only managed:admin,
-- managed:cap-*, and explicit managed:{role}@{scope} remain — see
-- docs/specs/authz/ROLES-CAPABILITIES-SPEC.md §7). Attachment rows carrying the
-- old bare ids would no longer resolve to any document, so drop them instead of
-- leaving inert rows behind. Same for pending invitation grants.
DELETE FROM "policy_attachment"
  WHERE "policy_id" IN ('managed:developer', 'managed:viewer', 'managed:maintainer');

DELETE FROM "invitation_grant"
  WHERE "policy_id" IN ('managed:developer', 'managed:viewer', 'managed:maintainer');
