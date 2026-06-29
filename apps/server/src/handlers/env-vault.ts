import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertPermission } from "../auth/permissions";
import { BadRequest, Conflict, NotFound } from "../errors";
import { toApiCrudEffect, toApiWriteEffect } from "../http/to-api-effect";
import { toApiOrgEnvVaultKeyWrap, toApiOrgVault } from "../http/to-api-vault";
import { AccountKeyRepo } from "../repositories/account-keys";
import { OrgEnvVaultRepo } from "../repositories/org-env-vault";
import { OrgVaultRepo } from "../repositories/org-vault";
import { UserEncryptionKeyRepo } from "../repositories/user-encryption-keys";
import { isEnvVaultForked } from "../vault-models";

import type { CurrentActor as Actor } from "../models";
import type { EnvVaultRecipientKind } from "../vault-models";

interface EnvWrapInputShape {
  readonly recipientKind: EnvVaultRecipientKind;
  readonly recipientId: string;
  readonly wrappedKey: string;
}

/** Recipient-set rules for a cutover / rotation: distinct, and a recovery recipient retained. */
const assertEnvWrapSet = (wraps: readonly EnvWrapInputShape[]): Effect.Effect<void, BadRequest> =>
  Effect.gen(function* () {
    const keys = wraps.map((wrap) => `${wrap.recipientKind}:${wrap.recipientId}`);
    if (new Set(keys).size !== keys.length) {
      return yield* new BadRequest({ message: "Duplicate recipient in env-vault wraps" });
    }
    if (!wraps.some((wrap) => wrap.recipientKind === "recovery")) {
      return yield* new BadRequest({
        message: "Env-vault wraps must keep an offline recovery recipient",
      });
    }
  });

/** Coverage rule: a cutover / rotation must re-key EVERY env-var revision. */
const assertCoversAllEnvDeks = (
  refIds: readonly string[],
  envDeks: readonly { readonly credentialId: string }[],
): Effect.Effect<void, BadRequest> =>
  Effect.gen(function* () {
    const submitted = new Set(envDeks.map((dek) => dek.credentialId));
    if (submitted.size !== envDeks.length) {
      return yield* new BadRequest({ message: "Duplicate env value in DEK updates" });
    }
    const expected = new Set(refIds);
    const coversAll =
      expected.size === submitted.size && [...expected].every((id) => submitted.has(id));
    if (!coversAll) {
      return yield* new BadRequest({
        message: `Must re-wrap every env value at the current version (${expected.size}); partial refused`,
      });
    }
  });

/** Resolve a polymorphic env recipient's owner + state for grant/fetch authz. */
const resolveEnvRecipient = (params: {
  readonly recipientKind: EnvVaultRecipientKind;
  readonly recipientId: string;
}) =>
  Effect.gen(function* () {
    if (params.recipientKind === "account") {
      const accountRepo = yield* AccountKeyRepo;
      const accountKey = yield* accountRepo.findById({ id: params.recipientId });
      return {
        ownerUserId: accountKey.userId,
        organizationId: null,
        revoked: accountKey.revokedAt !== null,
        isOwnable: true,
      };
    }
    const keyRepo = yield* UserEncryptionKeyRepo;
    const key = yield* keyRepo.findById({ id: params.recipientId });
    return {
      ownerUserId: key.userId,
      organizationId: key.organizationId,
      revoked: key.revokedAt !== null,
      isOwnable: key.kind === "device",
    };
  });

/** Is this recipient the caller's own (their device or their account key)? */
const isSelfRecipient = (
  recipient: { readonly ownerUserId: string | null; readonly isOwnable: boolean },
  ctx: Actor,
): boolean => recipient.isOwnable && ctx.userId !== null && recipient.ownerUserId === ctx.userId;

export const EnvVaultGroupLive = HttpApiBuilder.group(ManagementApi, "envVault", (handlers) =>
  handlers
    .handle("cutover", ({ payload }) =>
      toApiWriteEffect(
        Effect.gen(function* () {
          // The cutover re-keys env in place — a destructive admin op (un-upgraded
          // CLIs lose env read afterwards), gated like a rotation. Also require
          // `create` (the grant capability): the client re-wraps the env key to the
          // FULL recipient set, and the recipient view it sources is only complete
          // for grant-capable callers — without this gate a delete-but-not-create
          // principal would silently wrap to a narrowed set, locking others out.
          yield* assertPermission("vaultAccess", "delete");
          yield* assertPermission("vaultAccess", "create");
          const ctx = yield* CurrentActor;
          const vaultRepo = yield* OrgVaultRepo;
          const envRepo = yield* OrgEnvVaultRepo;

          const vault = yield* vaultRepo.getVault({ organizationId: ctx.organizationId });
          if (vault === null) {
            return yield* new NotFound({ message: "Vault not initialized" });
          }
          if (isEnvVaultForked(vault)) {
            return yield* new Conflict({ message: "Env vault already cut over" });
          }

          yield* assertEnvWrapSet(payload.wraps);
          const refs = yield* envRepo.listEnvCredentialRefs({ organizationId: ctx.organizationId });
          yield* assertCoversAllEnvDeks(
            refs.map((ref) => ref.id),
            payload.envDeks,
          );

          const now = new Date().toISOString();
          const cutVault = yield* envRepo.cutover({
            organizationId: ctx.organizationId,
            wraps: payload.wraps,
            envDeks: payload.envDeks,
            now,
          });

          yield* logAudit({
            action: "vault.env.cutover",
            resourceType: "vaultAccess",
            resourceId: ctx.organizationId,
            metadata: { recipientCount: payload.wraps.length, envCount: payload.envDeks.length },
          });

          return toApiOrgVault(cutVault);
        }),
      ),
    )
    .handle("listWraps", () =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertPermission("vaultAccess", "read");
          const ctx = yield* CurrentActor;
          const vaultRepo = yield* OrgVaultRepo;
          const envRepo = yield* OrgEnvVaultRepo;
          const vault = yield* vaultRepo.getVault({ organizationId: ctx.organizationId });
          if (vault === null || !isEnvVaultForked(vault)) {
            return yield* new NotFound({ message: "Env vault not initialized" });
          }
          const wraps = yield* envRepo.listEnvWraps({
            organizationId: ctx.organizationId,
            envVaultVersion: vault.envVaultVersion,
          });
          return {
            envVaultVersion: vault.envVaultVersion,
            recipients: wraps.map((wrap) => ({
              recipientKind: wrap.recipientKind,
              recipientId: wrap.recipientId,
              createdAt: wrap.createdAt,
            })),
          };
        }),
      ),
    )
    .handle("addWrap", ({ payload }) =>
      toApiWriteEffect(
        Effect.gen(function* () {
          yield* assertPermission("vaultAccess", "read");
          const ctx = yield* CurrentActor;
          const vaultRepo = yield* OrgVaultRepo;
          const envRepo = yield* OrgEnvVaultRepo;

          const recipient = yield* resolveEnvRecipient(payload.wrap);
          if (recipient.revoked) {
            return yield* new BadRequest({ message: "Cannot wrap the env vault to a revoked key" });
          }
          if (
            recipient.organizationId !== null &&
            recipient.organizationId !== ctx.organizationId
          ) {
            return yield* new BadRequest({
              message: "Recipient key belongs to another organization",
            });
          }
          // Self-link (own device / own account key) is self-service; wrapping to
          // anyone else's recipient is an admin grant.
          if (!isSelfRecipient(recipient, ctx)) {
            yield* assertPermission("vaultAccess", "create");
          }

          const vault = yield* vaultRepo.getVault({ organizationId: ctx.organizationId });
          if (vault === null || !isEnvVaultForked(vault)) {
            return yield* new NotFound({ message: "Env vault not initialized" });
          }

          const now = new Date().toISOString();
          const wrap = yield* envRepo.addEnvWrap({
            organizationId: ctx.organizationId,
            envVaultVersion: payload.envVaultVersion,
            recipientKind: payload.wrap.recipientKind,
            recipientId: payload.wrap.recipientId,
            wrappedKey: payload.wrap.wrappedKey,
            now,
          });

          yield* logAudit({
            action: "vault.env.wrap.add",
            resourceType: "vaultAccess",
            resourceId: payload.wrap.recipientId,
            metadata: {
              recipientKind: payload.wrap.recipientKind,
              selfLink: isSelfRecipient(recipient, ctx),
            },
          });

          return toApiOrgEnvVaultKeyWrap(wrap);
        }),
      ),
    )
    .handle("getWrap", ({ path }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertPermission("vaultAccess", "read");
          const ctx = yield* CurrentActor;
          const vaultRepo = yield* OrgVaultRepo;
          const envRepo = yield* OrgEnvVaultRepo;

          const recipient = yield* resolveEnvRecipient(path);
          const isOwn = isSelfRecipient(recipient, ctx);
          const isOrgKey = recipient.organizationId === ctx.organizationId;
          if (!isOwn && !isOrgKey) {
            return yield* new NotFound({ message: "Env recipient not found" });
          }

          const vault = yield* vaultRepo.getVault({ organizationId: ctx.organizationId });
          if (vault === null || !isEnvVaultForked(vault)) {
            return yield* new NotFound({ message: "Env vault not initialized" });
          }
          const wrap = yield* envRepo.findEnvWrap({
            organizationId: ctx.organizationId,
            envVaultVersion: vault.envVaultVersion,
            recipientKind: path.recipientKind,
            recipientId: path.recipientId,
          });
          if (wrap === null) {
            return yield* new NotFound({
              message: "No env-vault key wrap for this recipient — request access",
            });
          }
          return { envVaultVersion: wrap.envVaultVersion, wrappedKey: wrap.wrappedKey };
        }),
      ),
    )
    .handle("listCredentialDeks", () =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertPermission("vaultAccess", "read");
          const ctx = yield* CurrentActor;
          const vaultRepo = yield* OrgVaultRepo;
          const envRepo = yield* OrgEnvVaultRepo;
          const vault = yield* vaultRepo.getVault({ organizationId: ctx.organizationId });
          if (vault === null || !isEnvVaultForked(vault)) {
            return yield* new NotFound({ message: "Env vault not initialized" });
          }
          const deks = yield* envRepo.listEnvCredentialDeks({ organizationId: ctx.organizationId });
          return {
            envVaultVersion: vault.envVaultVersion,
            deks: deks.map((dek) => ({
              credentialId: dek.credentialId,
              wrappedDek: dek.wrappedDek,
              vaultVersion: dek.vaultVersion,
            })),
          };
        }),
      ),
    )
    .handle("rotate", ({ payload }) =>
      toApiWriteEffect(
        Effect.gen(function* () {
          // Rotation re-wraps the env key to the full surviving recipient set, so it
          // needs the grant capability too — see the cutover note above.
          yield* assertPermission("vaultAccess", "delete");
          yield* assertPermission("vaultAccess", "create");
          const ctx = yield* CurrentActor;
          const vaultRepo = yield* OrgVaultRepo;
          const envRepo = yield* OrgEnvVaultRepo;

          const vault = yield* vaultRepo.getVault({ organizationId: ctx.organizationId });
          if (vault === null || !isEnvVaultForked(vault)) {
            return yield* new NotFound({ message: "Env vault not initialized" });
          }
          if (vault.envVaultVersion !== payload.fromVersion) {
            return yield* new Conflict({
              message: "Env vault version changed since read; re-fetch and retry",
            });
          }

          yield* assertEnvWrapSet(payload.wraps);
          const refs = yield* envRepo.listEnvCredentialRefs({ organizationId: ctx.organizationId });
          yield* assertCoversAllEnvDeks(
            refs.map((ref) => ref.id),
            payload.envDeks,
          );

          const now = new Date().toISOString();
          const rotated = yield* envRepo.rotateEnv({
            organizationId: ctx.organizationId,
            fromVersion: payload.fromVersion,
            wraps: payload.wraps,
            envDeks: payload.envDeks,
            now,
          });

          yield* logAudit({
            action: "vault.env.rotate",
            resourceType: "vaultAccess",
            resourceId: ctx.organizationId,
            metadata: { fromVersion: payload.fromVersion, toVersion: rotated.envVaultVersion },
          });

          return toApiOrgVault(rotated);
        }),
      ),
    ),
);
