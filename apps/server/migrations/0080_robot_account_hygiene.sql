-- Hygiene for the robot_account rollout (0077-0079):
--
-- 1. The 0077 backfill copied EVERY machine-kind user_encryption_keys row into
--    robot_account — including revoked ones, carrying their revoked_at. Since a
--    robot revoke is now a hard DELETE and every live query filters
--    revoked_at IS NULL, those backfilled tombstones are unreachable rows that
--    would otherwise sit forever (and, before the query filters landed, showed
--    up as rotatable "active" robots). Remove them.
DELETE FROM "robot_account" WHERE "revoked_at" IS NOT NULL;

-- 2. Attachments used to be accepted for any robot principal id without an
--    existence check, and revoke did not clean attachments up. Drop any robot
--    attachment that no longer resolves to a live robot account (resolution
--    already ignored them — this is data hygiene, not a behavior change).
DELETE FROM "policy_attachment"
WHERE "principal_type" = 'robot'
  AND "principal_id" NOT IN (SELECT "id" FROM "robot_account");
