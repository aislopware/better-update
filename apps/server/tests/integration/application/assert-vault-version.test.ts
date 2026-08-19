import { env } from "cloudflare:workers";
import { Effect, Result } from "effect";

import { assertVaultVersionCurrent } from "../../../src/application/assert-vault-version";
import { OrgVaultRepo, OrgVaultRepoLive } from "../../../src/repositories/org-vault";
import { runResultWithLayerAndEnv } from "../../helpers/runtime";

// ── Helpers ───────────────────────────────────────────────────────

const runResult = async <Ret, Err>(effect: Effect.Effect<Ret, Err, OrgVaultRepo>) =>
  runResultWithLayerAndEnv(effect, OrgVaultRepoLive, env);

const insertOrg = async (id: string, slug: string) =>
  env.DB.prepare(
    `INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES (?, ?, ?, ?)`,
  )
    .bind(id, `Org ${slug}`, slug, "2026-01-01T00:00:00Z")
    .run();

// Org-owned recovery key — only needs the org FK to back a bootstrap wrap.
const insertOrgKey = async (id: string, organizationId: string) =>
  env.DB.prepare(
    `INSERT INTO "user_encryption_keys" ("id", "user_id", "organization_id", "kind", "public_key", "label", "fingerprint", "created_at") VALUES (?, NULL, ?, 'recovery', ?, ?, ?, ?)`,
  )
    .bind(id, organizationId, `age1${id}`, `Key ${id}`, `SHA256:${id}`, "2026-01-01T00:00:00Z")
    .run();

// ── Setup ─────────────────────────────────────────────────────────

beforeAll(async () => {
  // One org with a bootstrapped vault (version 1) and one with no vault at all.
  await insertOrg("avc-vault", "avc-vault");
  await insertOrg("avc-novault", "avc-novault");
  await insertOrgKey("avc-vault-r", "avc-vault");
  await runResult(
    Effect.gen(function* () {
      const repo = yield* OrgVaultRepo;
      yield* repo.bootstrap({
        organizationId: "avc-vault",
        wraps: [{ userEncryptionKeyId: "avc-vault-r", wrappedKey: "wrap-v1" }],
        envWraps: [
          { recipientKind: "recovery", recipientId: "avc-vault-r", wrappedKey: "env-wrap-v1" },
        ],
        now: "2026-02-01T00:00:00Z",
      });
    }),
  );
});

// ── Tests ─────────────────────────────────────────────────────────

describe(assertVaultVersionCurrent, () => {
  it("passes when the sealed version matches the current vault version", async () => {
    const result = await runResult(
      assertVaultVersionCurrent({ organizationId: "avc-vault", vaultVersion: 1 }),
    );
    expect(Result.isSuccess(result)).toBe(true);
  });

  it("rejects a stale version with Conflict (the rotation race)", async () => {
    const result = await runResult(
      assertVaultVersionCurrent({ organizationId: "avc-vault", vaultVersion: 2 }),
    );
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({ _tag: "Conflict" });
    }
  });

  it("does not gate an org that has no vault yet", async () => {
    // Absence of a vault means there is no rotation to be stale against, so any
    // version is accepted (a value can't be sealed without a vault anyway).
    const result = await runResult(
      assertVaultVersionCurrent({ organizationId: "avc-novault", vaultVersion: 99 }),
    );
    expect(Result.isSuccess(result)).toBe(true);
  });
});
