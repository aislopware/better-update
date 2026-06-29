import { it } from "@effect/vitest";
import { Effect, Either } from "effect";

import { OrgVaultRepo } from "../repositories/org-vault";
import { assertEnvVaultWriteAllowed } from "./assert-vault-version";

import type { OrgVaultModel } from "../vault-models";

const vaultStub = (opts: {
  readonly vaultVersion?: number;
  readonly forked?: boolean;
  readonly envVaultVersion?: number;
  readonly envRotationPending?: boolean;
}): OrgVaultModel => ({
  organizationId: "org-1",
  vaultVersion: opts.vaultVersion ?? 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  rotationPending: false,
  rotationPendingSince: null,
  rotationPendingReason: null,
  envVaultVersion: opts.envVaultVersion ?? 1,
  envRotationPending: opts.envRotationPending ?? false,
  envRotationPendingSince: null,
  envRotationPendingReason: null,
  envVaultCutoverAt: opts.forked === true ? "2026-04-02T00:00:00.000Z" : null,
});

const repo = (vault: OrgVaultModel | null) =>
  OrgVaultRepo.of({
    getVault: () => Effect.succeed(vault),
    bootstrap: () => Effect.die("unused"),
    findWrap: () => Effect.die("unused"),
    addWrap: () => Effect.die("unused"),
    listWraps: () => Effect.die("unused"),
    listCredentialRefs: () => Effect.die("unused"),
    listCredentialDeks: () => Effect.die("unused"),
    rotate: () => Effect.die("unused"),
    dropDeviceWrapsForUser: () => Effect.die("unused"),
  });

const run = (
  vault: OrgVaultModel | null,
  params: { vaultVersion: number; vaultKind?: "credentials" | "env" },
) =>
  assertEnvVaultWriteAllowed({ organizationId: "org-1", ...params }).pipe(
    Effect.provideService(OrgVaultRepo, repo(vault)),
    Effect.either,
  );

describe(assertEnvVaultWriteAllowed, () => {
  it.effect(
    "pre-cutover: an old CLI (no vaultKind) at the current credentials version passes",
    () =>
      Effect.gen(function* () {
        const result = yield* run(vaultStub({ vaultVersion: 1, forked: false }), {
          vaultVersion: 1,
        });
        expect(Either.isRight(result)).toBe(true);
      }),
  );

  it.effect('pre-cutover: a "credentials"-kind write at the current version passes', () =>
    Effect.gen(function* () {
      const result = yield* run(vaultStub({ vaultVersion: 3, forked: false }), {
        vaultVersion: 3,
        vaultKind: "credentials",
      });
      expect(Either.isRight(result)).toBe(true);
    }),
  );

  it.effect('pre-cutover: a stray "env"-kind write is rejected', () =>
    Effect.gen(function* () {
      const result = yield* run(vaultStub({ forked: false }), {
        vaultVersion: 1,
        vaultKind: "env",
      });
      expect(Either.isLeft(result)).toBe(true);
    }),
  );

  it.effect("post-cutover: an env write at the current env version passes", () =>
    Effect.gen(function* () {
      const result = yield* run(vaultStub({ forked: true, envVaultVersion: 1 }), {
        vaultVersion: 1,
        vaultKind: "env",
      });
      expect(Either.isRight(result)).toBe(true);
    }),
  );

  it.effect(
    "post-cutover: an OLD CLI (no vaultKind) is REJECTED even when versions collide at 1",
    () =>
      // The P1 case: credentials v1 == env v1 numerically, so without the kind
      // discriminator this credentials-keyed write would be silently stored + lost.
      Effect.gen(function* () {
        const result = yield* run(
          vaultStub({ vaultVersion: 1, forked: true, envVaultVersion: 1 }),
          {
            vaultVersion: 1,
          },
        );
        expect(Either.isLeft(result)).toBe(true);
      }),
  );

  it.effect('post-cutover: a racing "credentials"-kind write is rejected', () =>
    Effect.gen(function* () {
      const result = yield* run(vaultStub({ vaultVersion: 1, forked: true, envVaultVersion: 1 }), {
        vaultVersion: 1,
        vaultKind: "credentials",
      });
      expect(Either.isLeft(result)).toBe(true);
    }),
  );

  it.effect("post-cutover: an env write is rejected while the env vault is pending rotation", () =>
    Effect.gen(function* () {
      const result = yield* run(
        vaultStub({ forked: true, envVaultVersion: 2, envRotationPending: true }),
        { vaultVersion: 2, vaultKind: "env" },
      );
      expect(Either.isLeft(result)).toBe(true);
    }),
  );

  it.effect("post-cutover: a stale env version is rejected", () =>
    Effect.gen(function* () {
      const result = yield* run(vaultStub({ forked: true, envVaultVersion: 2 }), {
        vaultVersion: 1,
        vaultKind: "env",
      });
      expect(Either.isLeft(result)).toBe(true);
    }),
  );

  it.effect("no vault yet: not gated (nothing to be stale against)", () =>
    Effect.gen(function* () {
      const result = yield* run(null, { vaultVersion: 1, vaultKind: "env" });
      expect(Either.isRight(result)).toBe(true);
    }),
  );
});
