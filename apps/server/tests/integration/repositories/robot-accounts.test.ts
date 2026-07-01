import { env } from "cloudflare:test";
import { Effect, Layer } from "effect";

import { CryptoServiceLive } from "../../../src/cloudflare/crypto-service";
import { RobotAccountRepo, RobotAccountRepoLive } from "../../../src/repositories/robot-accounts";
import { runWithLayerAndEnv } from "../../helpers/runtime";

// ── Setup ─────────────────────────────────────────────────────────

// `RobotAccountRepoLive` yields `CryptoService`; provide its Live adapter so the
// repo hashes through the same Web Crypto path the worker uses. The composed
// layer has no outstanding requirements, so `runWithLayerAndEnv` runs it against
// the real local D1 (env.DB).
const REPO = RobotAccountRepoLive.pipe(Layer.provide(CryptoServiceLive));

const run = <Ret, Err>(effect: Effect.Effect<Ret, Err, RobotAccountRepo>) =>
  runWithLayerAndEnv(effect, REPO, env);

const insertOrg = (id: string) =>
  env.DB.prepare(
    `INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES (?, ?, ?, ?)`,
  )
    .bind(id, `Org ${id}`, `${id}-slug`, "2026-01-01T00:00:00Z")
    .run();

// A minimal machine-kind `user_encryption_keys` row to satisfy the
// `robot_account.user_encryption_key_id` FK — the repo never writes this table
// itself (the handler does, via `UserEncryptionKeyRepo.insert`).
const insertMachineKey = (id: string, organizationId: string) =>
  env.DB.prepare(
    `INSERT INTO "user_encryption_keys"
       ("id", "organization_id", "kind", "public_key", "label", "fingerprint", "created_at")
     VALUES (?, ?, 'machine', ?, ?, ?, ?)`,
  )
    .bind(
      id,
      organizationId,
      `age1fixture${id}`,
      `robot-${id}`,
      `SHA256:fixture-${id}`,
      "2026-01-01T00:00:00Z",
    )
    .run();

beforeAll(async () => {
  await insertOrg("org-robot-1");
  await insertOrg("org-robot-2");
  // `robot_account.user_encryption_key_id` is unique — one robot per vault
  // identity — so every `create()` call below needs its own machine key.
  await insertMachineKey("key-robot-1", "org-robot-1");
  await insertMachineKey("key-tamper-1", "org-robot-1");
  await insertMachineKey("key-rotate-1", "org-robot-1");
  await insertMachineKey("key-list-A", "org-robot-2");
  await insertMachineKey("key-revoke-1", "org-robot-2");
});

// ── Tests ─────────────────────────────────────────────────────────

describe("RobotAccountRepo — create → verifyBearer (the linchpin)", () => {
  it("a self-minted bearer verifies and resolves to the minting org", async () => {
    const created = await run(
      Effect.gen(function* () {
        const repo = yield* RobotAccountRepo;
        return yield* repo.create({
          organizationId: "org-robot-1",
          name: "ci-deploy",
          userEncryptionKeyId: "key-robot-1",
        });
      }),
    );

    expect(created.bearerSecret.startsWith("bu_robot_")).toBe(true);
    expect(created.model.bearerStart).toBe(created.bearerSecret.slice(0, 6));
    expect(created.model.hasBearer).toBe(true);
    expect(created.model.userEncryptionKeyId).toBe("key-robot-1");

    const verified = await run(
      Effect.gen(function* () {
        const repo = yield* RobotAccountRepo;
        return yield* repo.verifyBearer({ plaintext: created.bearerSecret });
      }),
    );
    expect(verified).toStrictEqual({ id: created.model.id, organizationId: "org-robot-1" });
  });

  it("a tampered plaintext does NOT verify (hash binds the exact bearer)", async () => {
    const created = await run(
      Effect.gen(function* () {
        const repo = yield* RobotAccountRepo;
        return yield* repo.create({
          organizationId: "org-robot-1",
          name: "tamper",
          userEncryptionKeyId: "key-tamper-1",
        });
      }),
    );

    const last = created.bearerSecret.at(-1);
    const tampered = `${created.bearerSecret.slice(0, -1)}${last === "a" ? "b" : "a"}`;
    const verified = await run(
      Effect.gen(function* () {
        const repo = yield* RobotAccountRepo;
        return yield* repo.verifyBearer({ plaintext: tampered });
      }),
    );
    expect(verified).toBeNull();
  });
});

describe("RobotAccountRepo — list / rotateBearer / revoke (org-scoped)", () => {
  it("lists an org's robots newest-first and never surfaces the hashed bearer", async () => {
    await run(
      Effect.gen(function* () {
        const repo = yield* RobotAccountRepo;
        yield* repo.create({
          organizationId: "org-robot-2",
          name: "robot-A",
          userEncryptionKeyId: "key-list-A",
        });
      }),
    );

    const listed = await run(
      Effect.gen(function* () {
        const repo = yield* RobotAccountRepo;
        return yield* repo.list({ organizationId: "org-robot-2" });
      }),
    );

    expect(listed.some((model) => model.name === "robot-A")).toBe(true);
    expect(listed.every((model) => !("bearerKeyHash" in model))).toBe(true);
  });

  it("rotateBearer re-mints the secret without touching the linked vault identity", async () => {
    const created = await run(
      Effect.gen(function* () {
        const repo = yield* RobotAccountRepo;
        return yield* repo.create({
          organizationId: "org-robot-1",
          name: "to-rotate",
          userEncryptionKeyId: "key-rotate-1",
        });
      }),
    );

    const rotated = await run(
      Effect.gen(function* () {
        const repo = yield* RobotAccountRepo;
        return yield* repo.rotateBearer({
          id: created.model.id,
          organizationId: "org-robot-1",
        });
      }),
    );
    expect(rotated.bearerSecret).not.toBe(created.bearerSecret);

    // Old bearer is dead; new one verifies; the vault identity link is untouched.
    const oldVerify = await run(
      Effect.gen(function* () {
        const repo = yield* RobotAccountRepo;
        return yield* repo.verifyBearer({ plaintext: created.bearerSecret });
      }),
    );
    expect(oldVerify).toBeNull();

    const newVerify = await run(
      Effect.gen(function* () {
        const repo = yield* RobotAccountRepo;
        return yield* repo.verifyBearer({ plaintext: rotated.bearerSecret });
      }),
    );
    expect(newVerify?.id).toBe(created.model.id);

    const found = await run(
      Effect.gen(function* () {
        const repo = yield* RobotAccountRepo;
        return yield* repo.findById({ id: created.model.id, organizationId: "org-robot-1" });
      }),
    );
    expect(found.userEncryptionKeyId).toBe("key-rotate-1");
  });

  it("revoke is org-scoped: not deletable from another org, then a real revoke removes it and breaks verify", async () => {
    const created = await run(
      Effect.gen(function* () {
        const repo = yield* RobotAccountRepo;
        return yield* repo.create({
          organizationId: "org-robot-2",
          name: "to-revoke",
          userEncryptionKeyId: "key-revoke-1",
        });
      }),
    );

    const crossOrg = await run(
      Effect.gen(function* () {
        const repo = yield* RobotAccountRepo;
        return yield* repo.revoke({ id: created.model.id, organizationId: "org-robot-1" });
      }),
    );
    expect(crossOrg).toBe(false);
    expect(
      (
        await run(
          Effect.gen(function* () {
            const repo = yield* RobotAccountRepo;
            return yield* repo.verifyBearer({ plaintext: created.bearerSecret });
          }),
        )
      )?.id,
    ).toBe(created.model.id);

    const deleted = await run(
      Effect.gen(function* () {
        const repo = yield* RobotAccountRepo;
        return yield* repo.revoke({ id: created.model.id, organizationId: "org-robot-2" });
      }),
    );
    expect(deleted).toBe(true);

    const verifiedAfter = await run(
      Effect.gen(function* () {
        const repo = yield* RobotAccountRepo;
        return yield* repo.verifyBearer({ plaintext: created.bearerSecret });
      }),
    );
    expect(verifiedAfter).toBeNull();

    const again = await run(
      Effect.gen(function* () {
        const repo = yield* RobotAccountRepo;
        return yield* repo.revoke({ id: created.model.id, organizationId: "org-robot-2" });
      }),
    );
    expect(again).toBe(false);
  });
});
