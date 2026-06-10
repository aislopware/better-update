import { env } from "cloudflare:test";
import { Effect, Layer } from "effect";

import { reconcileVaultRecipients } from "../../../src/application/reconcile-vault-recipients";
import { GroupRepoLive } from "../../../src/repositories/group-repo";
import { MemberRepoLive } from "../../../src/repositories/member-repo";
import { OrgVaultRepo, OrgVaultRepoLive } from "../../../src/repositories/org-vault";
import {
  PolicyAttachmentRepo,
  PolicyAttachmentRepoLive,
} from "../../../src/repositories/policy-attachment-repo";
import { PolicyRepoLive } from "../../../src/repositories/policy-repo";
import { UserEncryptionKeyRepoLive } from "../../../src/repositories/user-encryption-keys";
import { runWithLayerAndEnv } from "../../helpers/runtime";

// reconcile pulls together the vault, user-keys, member, and the three policy
// repos (for resolveEffectiveStatements) — provide all the real D1-backed layers.
const REPOS = Layer.mergeAll(
  OrgVaultRepoLive,
  UserEncryptionKeyRepoLive,
  MemberRepoLive,
  GroupRepoLive,
  PolicyAttachmentRepoLive,
  PolicyRepoLive,
);

const run = <Ret, Err>(effect: Effect.Effect<Ret, Err, never>) =>
  runWithLayerAndEnv(effect, REPOS, env);

const ORG = "rec-org";

const insertOrg = (id: string) =>
  env.DB.prepare(
    `INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES (?, ?, ?, ?)`,
  )
    .bind(id, `Org ${id}`, `${id}-slug`, "2026-01-01T00:00:00Z")
    .run();

const insertUser = (id: string) =>
  env.DB.prepare(
    `INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at") VALUES (?, ?, ?, 1, ?, ?)`,
  )
    .bind(id, `User ${id}`, `${id}@example.com`, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z")
    .run();

const insertMember = (id: string, userId: string, role: string) =>
  env.DB.prepare(
    `INSERT INTO "member" ("id", "organization_id", "user_id", "role", "created_at") VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(id, ORG, userId, role, "2026-01-01T00:00:00Z")
    .run();

const insertDeviceKey = (id: string, userId: string) =>
  env.DB.prepare(
    `INSERT INTO "user_encryption_keys" ("id", "user_id", "organization_id", "kind", "public_key", "label", "fingerprint", "created_at") VALUES (?, ?, NULL, 'device', ?, ?, ?, ?)`,
  )
    .bind(id, userId, `age1${id}`, `Key ${id}`, `SHA256:${id}`, "2026-01-01T00:00:00Z")
    .run();

const insertOrgKey = (id: string) =>
  env.DB.prepare(
    `INSERT INTO "user_encryption_keys" ("id", "user_id", "organization_id", "kind", "public_key", "label", "fingerprint", "created_at") VALUES (?, NULL, ?, 'recovery', ?, ?, ?, ?)`,
  )
    .bind(id, ORG, `age1${id}`, `Key ${id}`, `SHA256:${id}`, "2026-01-01T00:00:00Z")
    .run();

const countWraps = async (userEncryptionKeyId: string) => {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM "org_vault_key_wraps" WHERE "organization_id" = ? AND "user_encryption_key_id" = ?`,
  )
    .bind(ORG, userEncryptionKeyId)
    .first<{ n: number }>();
  return row?.n ?? 0;
};

beforeAll(async () => {
  await insertOrg(ORG);
  // owner: kept via the owner root bypass even though they hold NO policy.
  await insertUser("rec-u-owner");
  await insertMember("rec-m-owner", "rec-u-owner", "owner");
  await insertDeviceKey("rec-dk-owner", "rec-u-owner");
  // developer: kept — managed:developer grants vaultAccess:read.
  await insertUser("rec-u-dev");
  await insertMember("rec-m-dev", "rec-u-dev", "member");
  await insertDeviceKey("rec-dk-dev", "rec-u-dev");
  // viewer: dropped — managed:viewer no longer grants any vaultAccess.
  await insertUser("rec-u-viewer");
  await insertMember("rec-m-viewer", "rec-u-viewer", "member");
  await insertDeviceKey("rec-dk-viewer", "rec-u-viewer");
  // gone: dropped — a device wrap lingering for a user who is no longer a member.
  await insertUser("rec-u-gone");
  await insertDeviceKey("rec-dk-gone", "rec-u-gone");
  // org-owned recovery key: never user-scoped, must be untouched.
  await insertOrgKey("rec-r");

  await run(
    Effect.gen(function* () {
      const vault = yield* OrgVaultRepo;
      yield* vault.bootstrap({
        organizationId: ORG,
        wraps: [
          { userEncryptionKeyId: "rec-dk-owner", wrappedKey: "w-owner" },
          { userEncryptionKeyId: "rec-dk-dev", wrappedKey: "w-dev" },
          { userEncryptionKeyId: "rec-dk-viewer", wrappedKey: "w-viewer" },
          { userEncryptionKeyId: "rec-dk-gone", wrappedKey: "w-gone" },
          { userEncryptionKeyId: "rec-r", wrappedKey: "w-recovery" },
        ],
        now: "2026-05-01T00:00:00Z",
      });
      const attach = yield* PolicyAttachmentRepo;
      yield* attach.attach({
        organizationId: ORG,
        policyId: "managed:developer",
        principal: { type: "member", id: "rec-m-dev" },
      });
      yield* attach.attach({
        organizationId: ORG,
        policyId: "managed:viewer",
        principal: { type: "member", id: "rec-m-viewer" },
      });
    }),
  );
});

describe("reconcileVaultRecipients — D1 integration", () => {
  it("drops only recipients who lost vault access; keeps owner/developer/org keys", async () => {
    const dropped = await run(
      reconcileVaultRecipients({ organizationId: ORG, reason: "downgrade-test" }),
    );

    // Dropped: the downgraded viewer + the no-longer-a-member user.
    expect([...dropped].sort()).toEqual(["rec-u-gone", "rec-u-viewer"]);

    // Their wraps are gone.
    expect(await countWraps("rec-dk-viewer")).toBe(0);
    expect(await countWraps("rec-dk-gone")).toBe(0);

    // Kept: owner (root bypass, no policy), developer (vaultAccess:read), org recovery key.
    expect(await countWraps("rec-dk-owner")).toBe(1);
    expect(await countWraps("rec-dk-dev")).toBe(1);
    expect(await countWraps("rec-r")).toBe(1);

    // A recipient was dropped → the vault is flagged for rotation.
    const vault = await run(
      Effect.gen(function* () {
        const repo = yield* OrgVaultRepo;
        return yield* repo.getVault({ organizationId: ORG });
      }),
    );
    expect(vault?.rotationPending).toBe(true);
    expect(vault?.rotationPendingReason).toBe("downgrade-test");
  });

  it("is a no-op on a second pass (everyone left now qualifies)", async () => {
    const dropped = await run(
      reconcileVaultRecipients({ organizationId: ORG, reason: "downgrade-test-2" }),
    );
    expect(dropped).toEqual([]);
  });
});
