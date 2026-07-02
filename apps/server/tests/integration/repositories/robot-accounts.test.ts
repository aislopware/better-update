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

// `create` mints the machine-kind vault recipient itself (one atomic batch with
// the robot row), so each call just needs a unique keypair fixture.
const createRobot = (organizationId: string, name: string) =>
  run(
    Effect.gen(function* () {
      const repo = yield* RobotAccountRepo;
      return yield* repo.create({
        organizationId,
        name,
        publicKey: `age1fixture-${organizationId}-${name}`,
        fingerprint: `SHA256:fixture-${organizationId}-${name}`,
      });
    }),
  );

beforeAll(async () => {
  await insertOrg("org-robot-1");
  await insertOrg("org-robot-2");
});

// ── Tests ─────────────────────────────────────────────────────────

describe("RobotAccountRepo — create → verifyBearer (the linchpin)", () => {
  it("a self-minted bearer verifies and resolves to the minting org (with its name)", async () => {
    const created = await createRobot("org-robot-1", "ci-deploy");

    expect(created.bearerSecret.startsWith("bu_robot_")).toBe(true);
    expect(created.model.bearerStart).toBe(created.bearerSecret.slice(0, 6));
    expect(created.model.hasBearer).toBe(true);
    expect(created.model.userEncryptionKeyId).not.toBeNull();

    const verified = await run(
      Effect.gen(function* () {
        const repo = yield* RobotAccountRepo;
        return yield* repo.verifyBearer({ plaintext: created.bearerSecret });
      }),
    );
    expect(verified).toStrictEqual({
      id: created.model.id,
      organizationId: "org-robot-1",
      name: "ci-deploy",
    });
  });

  it("create also lands the machine-kind vault recipient row, linked 1:1", async () => {
    const created = await createRobot("org-robot-1", "with-key");

    const keyRow = await env.DB.prepare(
      `SELECT "kind", "organization_id", "user_id", "label", "public_key"
       FROM "user_encryption_keys" WHERE "id" = ?`,
    )
      .bind(created.model.userEncryptionKeyId)
      .first<{
        kind: string;
        organization_id: string;
        user_id: string | null;
        label: string;
        public_key: string;
      }>();

    expect(keyRow).not.toBeNull();
    expect(keyRow?.kind).toBe("machine");
    expect(keyRow?.organization_id).toBe("org-robot-1");
    expect(keyRow?.user_id).toBeNull();
    expect(keyRow?.label).toBe("with-key");
    expect(keyRow?.public_key).toBe("age1fixture-org-robot-1-with-key");
  });

  it("a tampered plaintext does NOT verify (hash binds the exact bearer)", async () => {
    const created = await createRobot("org-robot-1", "tamper");

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

describe("RobotAccountRepo — revoked_at tombstones are dead to every query", () => {
  // The 0077 backfill copied revoked machine keys into robot_account with their
  // revoked_at set (cleaned up by 0080). Even if such a row exists, it must be
  // unreachable: not listed, not findable, not rotatable, and never verifying.
  it("a revoked row cannot verify, list, resolve, or be re-armed via rotate", async () => {
    const created = await createRobot("org-robot-1", "tombstone");
    await env.DB.prepare(`UPDATE "robot_account" SET "revoked_at" = ? WHERE "id" = ?`)
      .bind("2026-01-02T00:00:00Z", created.model.id)
      .run();

    const verified = await run(
      Effect.gen(function* () {
        const repo = yield* RobotAccountRepo;
        return yield* repo.verifyBearer({ plaintext: created.bearerSecret });
      }),
    );
    expect(verified).toBeNull();

    const listed = await run(
      Effect.gen(function* () {
        const repo = yield* RobotAccountRepo;
        return yield* repo.list({ organizationId: "org-robot-1" });
      }),
    );
    expect(listed.some((model) => model.id === created.model.id)).toBe(false);

    const found = await run(
      Effect.gen(function* () {
        const repo = yield* RobotAccountRepo;
        return yield* repo
          .findById({ id: created.model.id, organizationId: "org-robot-1" })
          .pipe(Effect.either);
      }),
    );
    expect(found._tag).toBe("Left");

    const rotated = await run(
      Effect.gen(function* () {
        const repo = yield* RobotAccountRepo;
        return yield* repo
          .rotateBearer({ id: created.model.id, organizationId: "org-robot-1" })
          .pipe(Effect.either);
      }),
    );
    expect(rotated._tag).toBe("Left");
  });
});

describe("RobotAccountRepo — list / rotateBearer / revoke (org-scoped)", () => {
  it("lists an org's robots newest-first and never surfaces the hashed bearer", async () => {
    await createRobot("org-robot-2", "robot-A");

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
    const created = await createRobot("org-robot-1", "to-rotate");

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
    expect(found.userEncryptionKeyId).toBe(created.model.userEncryptionKeyId);
  });

  it("revoke is org-scoped: not deletable from another org, then a real revoke removes it and breaks verify", async () => {
    const created = await createRobot("org-robot-2", "to-revoke");

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

  it("revoke atomically drops the robot's policy attachments (no dangling grants)", async () => {
    const created = await createRobot("org-robot-2", "with-grants");
    await env.DB.prepare(
      `INSERT INTO "policy_attachment"
         ("id", "organization_id", "policy_id", "principal_type", "principal_id", "created_at")
       VALUES (?, ?, ?, 'robot', ?, ?)`,
    )
      .bind(
        "att-robot-revoke-1",
        "org-robot-2",
        "managed:admin",
        created.model.id,
        "2026-01-01T00:00:00Z",
      )
      .run();

    const deleted = await run(
      Effect.gen(function* () {
        const repo = yield* RobotAccountRepo;
        return yield* repo.revoke({ id: created.model.id, organizationId: "org-robot-2" });
      }),
    );
    expect(deleted).toBe(true);

    const remaining = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM "policy_attachment" WHERE "principal_type" = 'robot' AND "principal_id" = ?`,
    )
      .bind(created.model.id)
      .first<{ n: number }>();
    expect(remaining?.n).toBe(0);
  });
});
