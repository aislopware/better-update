import { env } from "cloudflare:test";
import { Effect } from "effect";

import { AccountKeyRepo, AccountKeyRepoLive } from "../../../src/repositories/account-keys";
import {
  UserEncryptionKeyRepo,
  UserEncryptionKeyRepoLive,
} from "../../../src/repositories/user-encryption-keys";
import { runWithLayerAndEnv } from "../../helpers/runtime";

// ── Helpers ───────────────────────────────────────────────────────

const insertUser = (id: string) =>
  env.DB.prepare(
    `INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at") VALUES (?, ?, ?, 1, ?, ?)`,
  )
    .bind(id, `User ${id}`, `${id}@example.com`, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z")
    .run();

const insertDeviceKey = (id: string, userId: string) =>
  env.DB.prepare(
    `INSERT INTO "user_encryption_keys" ("id", "user_id", "organization_id", "kind", "public_key", "label", "fingerprint", "created_at") VALUES (?, ?, NULL, 'device', ?, ?, ?, ?)`,
  )
    .bind(id, userId, `age1${id}`, `Key ${id}`, `SHA256:${id}`, "2026-01-01T00:00:00Z")
    .run();

const insertAccountKey = (id: string, userId: string) =>
  env.DB.prepare(
    `INSERT INTO "account_keys" ("id", "user_id", "age_public_key", "ed25519_public_key", "escrow_ct", "salt", "kdf_params", "fingerprint", "created_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      userId,
      `age1${id}`,
      `ed${id}`,
      "ct",
      "salt",
      `{"time":1,"memory":64,"parallelism":1}`,
      `SHA256:${id}`,
      "2026-01-01T00:00:00Z",
    )
    .run();

const keyLastUsedAt = async (table: "user_encryption_keys" | "account_keys", id: string) => {
  const row = await env.DB.prepare(`SELECT "last_used_at" FROM "${table}" WHERE "id" = ?`)
    .bind(id)
    .first<{ last_used_at: string | null }>();
  return row?.last_used_at ?? null;
};

// ── Setup ─────────────────────────────────────────────────────────

beforeAll(async () => {
  await insertUser("klu-user");
  await insertDeviceKey("klu-device", "klu-user");
  await insertAccountKey("klu-account", "klu-user");
});

// ── Tests ─────────────────────────────────────────────────────────

describe("touchLastUsed — D1 integration", () => {
  it("stamps last_used_at on a user encryption key", async () => {
    expect(await keyLastUsedAt("user_encryption_keys", "klu-device")).toBeNull();
    await runWithLayerAndEnv(
      Effect.gen(function* () {
        const repo = yield* UserEncryptionKeyRepo;
        yield* repo.touchLastUsed({ id: "klu-device", now: "2026-07-06T12:00:00.000Z" });
      }),
      UserEncryptionKeyRepoLive,
      env,
    );
    expect(await keyLastUsedAt("user_encryption_keys", "klu-device")).toBe(
      "2026-07-06T12:00:00.000Z",
    );
  });

  it("stamps last_used_at on an account key", async () => {
    expect(await keyLastUsedAt("account_keys", "klu-account")).toBeNull();
    await runWithLayerAndEnv(
      Effect.gen(function* () {
        const repo = yield* AccountKeyRepo;
        yield* repo.touchLastUsed({ id: "klu-account", now: "2026-07-06T12:00:00.000Z" });
      }),
      AccountKeyRepoLive,
      env,
    );
    expect(await keyLastUsedAt("account_keys", "klu-account")).toBe("2026-07-06T12:00:00.000Z");
  });
});
