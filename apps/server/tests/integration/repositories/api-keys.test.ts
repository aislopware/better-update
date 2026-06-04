import { env } from "cloudflare:test";
import { Effect, Layer } from "effect";

import { createAuth } from "../../../src/auth";
import { CryptoServiceLive } from "../../../src/cloudflare/crypto-service";
import { ApiKeyRepo, ApiKeyRepoLive } from "../../../src/repositories/api-keys";
import { runWithLayerAndEnv } from "../../helpers/runtime";

// ── Setup ─────────────────────────────────────────────────────────

// `ApiKeyRepoLive` yields `CryptoService`; provide its Live adapter so the repo
// hashes through the same Web Crypto path the worker uses. The composed layer
// has no outstanding requirements, so `runWithLayerAndEnv` runs it against the
// real local D1 (env.DB).
const REPO = ApiKeyRepoLive.pipe(Layer.provide(CryptoServiceLive));

const run = <Ret, Err>(effect: Effect.Effect<Ret, Err, ApiKeyRepo>) =>
  runWithLayerAndEnv(effect, REPO, env);

const insertOrg = (id: string) =>
  env.DB.prepare(
    `INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES (?, ?, ?, ?)`,
  )
    .bind(id, `Org ${id}`, `${id}-slug`, "2026-01-01T00:00:00Z")
    .run();

// The better-auth `verifyApiKey` facade as wired in `auth/middleware.ts`. Types
// are not inferred from the plugin config, so we narrow what we read.
interface VerifyResult {
  readonly valid: boolean;
  readonly error: { readonly message: string; readonly code: string } | null;
  readonly key: { readonly id: string; readonly referenceId: string } | null;
}

const verify = (key: string): Promise<VerifyResult> =>
  createAuth(env).api.verifyApiKey({ body: { key } }) as Promise<VerifyResult>;

beforeAll(async () => {
  await insertOrg("org-apikey-1");
  await insertOrg("org-apikey-2");
});

// ── Tests ─────────────────────────────────────────────────────────

describe("ApiKeyRepo — mint → better-auth verify (the linchpin)", () => {
  it("a self-minted key is accepted by better-auth verifyApiKey (hash + columns match)", async () => {
    const minted = await run(
      Effect.gen(function* () {
        const repo = yield* ApiKeyRepo;
        return yield* repo.mint({
          organizationId: "org-apikey-1",
          name: "ci-deploy",
          expiresAt: null,
        });
      }),
    );

    // The plaintext is returned once; only its hash is stored.
    expect(minted.key.startsWith("bu_")).toBe(true);
    expect(minted.model.start).toBe(minted.key.slice(0, 6));
    expect(minted.model.enabled).toBe(true);

    // THE GATE: better-auth's own verify path must accept the row WE inserted.
    const result = await verify(minted.key);
    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
    expect(result.key?.id).toBe(minted.model.id);
    // `reference_id` carries the org id (plugin `references: "organization"`).
    expect(result.key?.referenceId).toBe("org-apikey-1");
  });

  it("a key with an explicit future expiry still verifies", async () => {
    const oneYear = new Date(Date.now() + 365 * 86_400_000).toISOString();
    const minted = await run(
      Effect.gen(function* () {
        const repo = yield* ApiKeyRepo;
        return yield* repo.mint({
          organizationId: "org-apikey-1",
          name: "expiring",
          expiresAt: oneYear,
        });
      }),
    );

    const result = await verify(minted.key);
    expect(result.valid).toBe(true);
    expect(result.key?.referenceId).toBe("org-apikey-1");
  });

  it("a tampered plaintext does NOT verify (hash binds the exact key)", async () => {
    const minted = await run(
      Effect.gen(function* () {
        const repo = yield* ApiKeyRepo;
        return yield* repo.mint({
          organizationId: "org-apikey-1",
          name: "tamper",
          expiresAt: null,
        });
      }),
    );

    // Flip the last character: a different plaintext hashes differently, so the
    // lookup misses.
    const last = minted.key.at(-1);
    const tampered = `${minted.key.slice(0, -1)}${last === "a" ? "b" : "a"}`;
    const result = await verify(tampered);
    expect(result.valid).toBe(false);
    expect(result.key).toBeNull();
  });
});

describe("ApiKeyRepo — list / revoke (org-scoped)", () => {
  it("lists an org's keys newest-first and never surfaces the hashed secret", async () => {
    await run(
      Effect.gen(function* () {
        const repo = yield* ApiKeyRepo;
        yield* repo.mint({ organizationId: "org-apikey-2", name: "key-A", expiresAt: null });
        yield* repo.mint({ organizationId: "org-apikey-2", name: "key-B", expiresAt: null });
      }),
    );

    const listed = await run(
      Effect.gen(function* () {
        const repo = yield* ApiKeyRepo;
        return yield* repo.list({ organizationId: "org-apikey-2" });
      }),
    );

    const names = listed.map((model) => model.name);
    expect(names).toContain("key-A");
    expect(names).toContain("key-B");
    // The model intentionally has no `key` field — the hash never leaves the repo.
    expect(listed.every((model) => !("key" in model))).toBe(true);
  });

  it("revoke is org-scoped: a key in org-2 is NOT deletable from org-1, then a real revoke removes it and breaks verify", async () => {
    const minted = await run(
      Effect.gen(function* () {
        const repo = yield* ApiKeyRepo;
        return yield* repo.mint({
          organizationId: "org-apikey-2",
          name: "to-revoke",
          expiresAt: null,
        });
      }),
    );

    // Cross-org revoke is a no-op (the org clause excludes it).
    const crossOrg = await run(
      Effect.gen(function* () {
        const repo = yield* ApiKeyRepo;
        return yield* repo.revoke({ id: minted.model.id, organizationId: "org-apikey-1" });
      }),
    );
    expect(crossOrg).toBe(false);

    // It still verifies — the cross-org delete did nothing.
    expect((await verify(minted.key)).valid).toBe(true);

    // Same-org revoke succeeds and the key no longer verifies.
    const deleted = await run(
      Effect.gen(function* () {
        const repo = yield* ApiKeyRepo;
        return yield* repo.revoke({ id: minted.model.id, organizationId: "org-apikey-2" });
      }),
    );
    expect(deleted).toBe(true);
    expect((await verify(minted.key)).valid).toBe(false);

    // A second revoke reports not-found.
    const again = await run(
      Effect.gen(function* () {
        const repo = yield* ApiKeyRepo;
        return yield* repo.revoke({ id: minted.model.id, organizationId: "org-apikey-2" });
      }),
    );
    expect(again).toBe(false);
  });
});
