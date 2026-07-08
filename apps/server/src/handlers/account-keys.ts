import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { assertWebEnvStepUp } from "../application/assert-web-env-step-up";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertVaultParticipant } from "../auth/permissions";
import { BadRequest, NotFound } from "../errors";
import { toApiCrudEffect, toApiWriteEffect } from "../http/to-api-effect";
import { toApiAccountKey, toApiAccountKeyEscrow } from "../http/to-api-vault";
import { AccountKeyRepo } from "../repositories/account-keys";
import { MemberRepo } from "../repositories/member-repo";

export const AccountKeysGroupLive = HttpApiBuilder.group(ManagementApi, "accountKeys", (handlers) =>
  handlers
    .handle("register", ({ payload }) =>
      toApiWriteEffect(
        Effect.gen(function* () {
          // An account key makes the caller an env-vault recipient (the browser
          // unwraps env with it), so gate it on the same vault-participation
          // rule device keys require. It is always the caller's OWN key — needs an interactive
          // user (api-key/CI actors use machine recipients, never account keys).
          yield* assertVaultParticipant;
          const ctx = yield* CurrentActor;
          if (ctx.userId === null) {
            return yield* new BadRequest({
              message: "Account keys require an interactive user session",
            });
          }

          const repo = yield* AccountKeyRepo;
          const id = crypto.randomUUID();
          const now = new Date().toISOString();

          // One live account key per user (DB partial-unique enforces it too); the
          // CLI checks `getMe` first for idempotency and uses `passphrase change`
          // to re-seal rather than re-register.
          yield* repo.insert({
            id,
            userId: ctx.userId,
            agePublicKey: payload.agePublicKey,
            ed25519PublicKey: payload.ed25519PublicKey,
            escrowCt: payload.escrowCt,
            salt: payload.salt,
            kdfParams: payload.kdfParams,
            fingerprint: payload.fingerprint,
            createdAt: now,
          });

          yield* logAudit({
            action: "vault.account-key.register",
            resourceType: "vaultAccess",
            resourceId: id,
            metadata: { fingerprint: payload.fingerprint },
          });

          return toApiAccountKey({
            id,
            userId: ctx.userId,
            agePublicKey: payload.agePublicKey,
            ed25519PublicKey: payload.ed25519PublicKey,
            escrowCt: payload.escrowCt,
            salt: payload.salt,
            kdfParams: payload.kdfParams,
            fingerprint: payload.fingerprint,
            createdAt: now,
            lastUsedAt: null,
            revokedAt: null,
          });
        }),
      ),
    )
    .handle("list", () =>
      toApiCrudEffect(
        Effect.gen(function* () {
          // Listing the org's account-key recipients mirrors `orgVault.listWraps`
          // (participant-gated); the cutover/rotate need it to wrap the env key.
          yield* assertVaultParticipant;
          const ctx = yield* CurrentActor;
          const memberRepo = yield* MemberRepo;
          const accountRepo = yield* AccountKeyRepo;
          // Account keys are per-user; the org's set is its members' live keys.
          const userIds = yield* memberRepo.listUserIds({ organizationId: ctx.organizationId });
          const keys = yield* accountRepo.listActiveByUsers({ userIds });
          return { items: keys.map(toApiAccountKey) };
        }),
      ),
    )
    .handle("reseal", ({ payload }) =>
      toApiWriteEffect(
        Effect.gen(function* () {
          yield* assertVaultParticipant;
          const ctx = yield* CurrentActor;
          if (ctx.userId === null) {
            return yield* new BadRequest({
              message: "Account keys require an interactive user session",
            });
          }
          // Re-seal overwrites the escrow blob, so a stolen browser cookie must not
          // clobber it without a fresh step-up (CLI bearer callers are exempt).
          yield* assertWebEnvStepUp(ctx);
          const repo = yield* AccountKeyRepo;
          const existing = yield* repo.findActiveByUser({ userId: ctx.userId });
          if (existing === null) {
            return yield* new NotFound({ message: "No account key registered for this user" });
          }
          // Overwrite only the passphrase-derived seal (escrow ct + salt + KDF);
          // the keypair — and thus every env-vault wrap to it — is untouched.
          yield* repo.updateEscrow({
            userId: ctx.userId,
            escrowCt: payload.escrowCt,
            salt: payload.salt,
            kdfParams: payload.kdfParams,
          });

          yield* logAudit({
            action: "vault.account-key.reseal",
            resourceType: "vaultAccess",
            resourceId: existing.id,
            metadata: { fingerprint: existing.fingerprint },
          });

          // The public view is unchanged by a re-seal (no escrow fields in it).
          return toApiAccountKey(existing);
        }),
      ),
    )
    .handle("getMe", () =>
      toApiCrudEffect(
        Effect.gen(function* () {
          // Same participation gate as register/list/reseal (a demoted member with
          // a leftover account-key row must not fetch its own escrow).
          yield* assertVaultParticipant;
          const ctx = yield* CurrentActor;
          if (ctx.userId === null) {
            return yield* new NotFound({ message: "No account key for this caller" });
          }
          // The escrow is passphrase-sealed (the server can't open it), so serving
          // it is not a plaintext leak. For BROWSER callers it is nonetheless the
          // entry point to unlocking the env vault, so it is gated behind a fresh
          // WebAuthn step-up (the "2FA before web env access" rule). CLI bearer
          // callers are exempt — they hold the vault key directly and only ever
          // fetch their own escrow. Fails closed when WebAuthn is unconfigured.
          yield* assertWebEnvStepUp(ctx);
          const repo = yield* AccountKeyRepo;
          const accountKey = yield* repo.findActiveByUser({ userId: ctx.userId });
          if (accountKey === null) {
            return yield* new NotFound({ message: "No account key registered for this user" });
          }
          return toApiAccountKeyEscrow(accountKey);
        }),
      ),
    ),
);
