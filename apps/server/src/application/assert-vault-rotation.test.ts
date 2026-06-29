import { it } from "@effect/vitest";
import { Effect, Either } from "effect";

import { OrgVaultRepo } from "../repositories/org-vault";
import {
  assertEnvVaultRotationNotPending,
  assertVaultRotationNotPending,
  ENV_VAULT_ROTATION_PENDING_MESSAGE,
  VAULT_ROTATION_PENDING_MESSAGE,
} from "./assert-vault-rotation";

import type { OrgVaultModel } from "../vault-models";

const vaultStub = (
  rotationPending: boolean,
  env: { readonly forked?: boolean; readonly envRotationPending?: boolean } = {},
): OrgVaultModel => ({
  organizationId: "org-1",
  vaultVersion: 3,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  rotationPending,
  rotationPendingSince: rotationPending ? "2026-04-01T00:00:00.000Z" : null,
  rotationPendingReason: rotationPending ? "member-removed:u-1" : null,
  envVaultVersion: 1,
  envRotationPending: env.envRotationPending ?? false,
  envRotationPendingSince: null,
  envRotationPendingReason: null,
  envVaultCutoverAt: env.forked === true ? "2026-04-02T00:00:00.000Z" : null,
});

// Only `getVault` is exercised by the gate; the rest must never be reached.
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

describe(assertVaultRotationNotPending, () => {
  it.effect("rejects with Conflict while the vault is flagged for rotation", () =>
    Effect.gen(function* () {
      const result = yield* assertVaultRotationNotPending({ organizationId: "org-1" }).pipe(
        Effect.provideService(OrgVaultRepo, repo(vaultStub(true))),
        Effect.either,
      );
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe("Conflict");
        expect(result.left.message).toBe(VAULT_ROTATION_PENDING_MESSAGE);
      }
    }),
  );

  it.effect("passes when the vault is not pending rotation", () =>
    Effect.gen(function* () {
      const result = yield* assertVaultRotationNotPending({ organizationId: "org-1" }).pipe(
        Effect.provideService(OrgVaultRepo, repo(vaultStub(false))),
        Effect.either,
      );
      expect(Either.isRight(result)).toBe(true);
    }),
  );

  it.effect("passes when the org has no vault yet (nothing to rotate)", () =>
    Effect.gen(function* () {
      const result = yield* assertVaultRotationNotPending({ organizationId: "org-1" }).pipe(
        Effect.provideService(OrgVaultRepo, repo(null)),
        Effect.either,
      );
      expect(Either.isRight(result)).toBe(true);
    }),
  );
});

describe(assertEnvVaultRotationNotPending, () => {
  it.effect("pre-cutover: env reads gate on the CREDENTIALS vault's pending flag", () =>
    Effect.gen(function* () {
      const result = yield* assertEnvVaultRotationNotPending({ organizationId: "org-1" }).pipe(
        Effect.provideService(OrgVaultRepo, repo(vaultStub(true, { forked: false }))),
        Effect.either,
      );
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left.message).toBe(VAULT_ROTATION_PENDING_MESSAGE);
      }
    }),
  );

  it.effect("post-cutover: a clean CREDENTIALS vault no longer blocks env reads", () =>
    Effect.gen(function* () {
      // CV is pending but env is clean — once forked, env reads only care about env.
      const result = yield* assertEnvVaultRotationNotPending({ organizationId: "org-1" }).pipe(
        Effect.provideService(
          OrgVaultRepo,
          repo(vaultStub(true, { forked: true, envRotationPending: false })),
        ),
        Effect.either,
      );
      expect(Either.isRight(result)).toBe(true);
    }),
  );

  it.effect("post-cutover: a pending ENV vault blocks env reads with the env message", () =>
    Effect.gen(function* () {
      const result = yield* assertEnvVaultRotationNotPending({ organizationId: "org-1" }).pipe(
        Effect.provideService(
          OrgVaultRepo,
          repo(vaultStub(false, { forked: true, envRotationPending: true })),
        ),
        Effect.either,
      );
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left.message).toBe(ENV_VAULT_ROTATION_PENDING_MESSAGE);
      }
    }),
  );
});
