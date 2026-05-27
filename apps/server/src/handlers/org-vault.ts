import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertPermission } from "../auth/permissions";
import { BadRequest, Conflict, NotFound } from "../errors";
import { toApiCrudEffect, toApiWriteEffect } from "../http/to-api-effect";
import { toApiOrgVault, toApiOrgVaultKeyWrap } from "../http/to-api-vault";
import { OrgVaultRepo } from "../repositories/org-vault";
import { UserEncryptionKeyRepo } from "../repositories/user-encryption-keys";

import type { CredentialRef, CurrentActor as Actor, UserEncryptionKeyModel } from "../models";

const FOREIGN_ORG_KEY_MESSAGE = "Recipient key belongs to another organization";

/** A recovery/machine key is org-owned; one registered under another org is invalid here. */
const isForeignOrgKey = (key: UserEncryptionKeyModel, ctx: Actor): boolean =>
  key.kind !== "device" && key.organizationId !== ctx.organizationId;

/** Recipient-set rules for a rotation: distinct, all in-org, recovery retained. */
const assertRotationRecipients = (
  keys: readonly UserEncryptionKeyModel[],
  recipientIds: readonly string[],
  ctx: Actor,
): Effect.Effect<void, BadRequest> =>
  Effect.gen(function* () {
    // A failed `yield*` short-circuits the generator, so no early `return` is
    // needed (and `consistent-return` forbids mixing it with the void fall-through).
    if (new Set(recipientIds).size !== recipientIds.length) {
      yield* Effect.fail(new BadRequest({ message: "Duplicate recipient in rotation wraps" }));
    }
    if (keys.some((key) => isForeignOrgKey(key, ctx))) {
      yield* Effect.fail(new BadRequest({ message: FOREIGN_ORG_KEY_MESSAGE }));
    }
    if (!keys.some((key) => key.kind === "recovery")) {
      yield* Effect.fail(
        new BadRequest({ message: "Rotation must keep an offline recovery recipient" }),
      );
    }
  });

/**
 * Coverage rule: a rotation must re-wrap EVERY credential at the current version.
 * A partial rotation would leave some credential decryptable by the old key, so
 * it is refused outright (concurrent uploads are kept out by the upload path's
 * own version check).
 */
const assertCoversAllCredentials = (
  refs: readonly CredentialRef[],
  credentialDeks: readonly { readonly credentialType: string; readonly credentialId: string }[],
): Effect.Effect<void, BadRequest> =>
  Effect.gen(function* () {
    const submitted = new Set(
      credentialDeks.map((dek) => `${dek.credentialType}:${dek.credentialId}`),
    );
    if (submitted.size !== credentialDeks.length) {
      yield* Effect.fail(
        new BadRequest({ message: "Duplicate credential in rotation DEK updates" }),
      );
    }
    const expected = new Set(refs.map((ref) => `${ref.credentialType}:${ref.id}`));
    const coversAll =
      expected.size === submitted.size && [...expected].every((key) => submitted.has(key));
    if (!coversAll) {
      yield* Effect.fail(
        new BadRequest({
          message: `Rotation must re-wrap every credential at the current version (${expected.size}); partial rotation refused`,
        }),
      );
    }
  });

export const OrgVaultGroupLive = HttpApiBuilder.group(ManagementApi, "orgVault", (handlers) =>
  handlers
    .handle("get", () =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertPermission("vaultAccess", "read");
          const ctx = yield* CurrentActor;
          const repo = yield* OrgVaultRepo;
          const vault = yield* repo.getVault({ organizationId: ctx.organizationId });
          if (vault === null) {
            return yield* Effect.fail(new NotFound({ message: "Vault not initialized" }));
          }
          return toApiOrgVault(vault);
        }),
      ),
    )
    .handle("bootstrap", ({ payload }) =>
      toApiWriteEffect(
        Effect.gen(function* () {
          yield* assertPermission("vaultAccess", "create");
          const ctx = yield* CurrentActor;
          const repo = yield* OrgVaultRepo;
          const keyRepo = yield* UserEncryptionKeyRepo;

          const ids = payload.wraps.map((wrap) => wrap.userEncryptionKeyId);
          if (new Set(ids).size !== ids.length) {
            return yield* Effect.fail(
              new BadRequest({ message: "Duplicate recipient in bootstrap wraps" }),
            );
          }

          const keys = yield* Effect.forEach(
            payload.wraps,
            (wrap) => keyRepo.findById({ id: wrap.userEncryptionKeyId }),
            { concurrency: "unbounded" },
          );
          if (keys.some((key) => isForeignOrgKey(key, ctx))) {
            return yield* Effect.fail(new BadRequest({ message: FOREIGN_ORG_KEY_MESSAGE }));
          }

          // Break-glass invariant: a vault with no offline recovery recipient can
          // be permanently lost if every device is lost, so require one up front.
          if (!keys.some((key) => key.kind === "recovery")) {
            return yield* Effect.fail(
              new BadRequest({ message: "Bootstrap must include an offline recovery recipient" }),
            );
          }

          const now = new Date().toISOString();
          const vault = yield* repo.bootstrap({
            organizationId: ctx.organizationId,
            wraps: payload.wraps,
            now,
          });

          yield* logAudit({
            action: "vault.bootstrap",
            resourceType: "vaultAccess",
            resourceId: ctx.organizationId,
            metadata: { recipientCount: payload.wraps.length },
          });

          return toApiOrgVault(vault);
        }),
      ),
    )
    .handle("listWraps", () =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertPermission("vaultAccess", "read");
          const ctx = yield* CurrentActor;
          const repo = yield* OrgVaultRepo;
          const vault = yield* repo.getVault({ organizationId: ctx.organizationId });
          if (vault === null) {
            return yield* Effect.fail(new NotFound({ message: "Vault not initialized" }));
          }
          const wraps = yield* repo.listWraps({
            organizationId: ctx.organizationId,
            vaultVersion: vault.vaultVersion,
          });
          return {
            vaultVersion: vault.vaultVersion,
            recipients: wraps.map((wrap) => ({
              userEncryptionKeyId: wrap.userEncryptionKeyId,
              createdAt: wrap.createdAt,
            })),
          };
        }),
      ),
    )
    .handle("addWrap", ({ payload }) =>
      toApiWriteEffect(
        Effect.gen(function* () {
          // Any member may reach this (read-gated) before we touch a key, so a
          // caller without vault access can't probe key existence.
          yield* assertPermission("vaultAccess", "read");
          const ctx = yield* CurrentActor;
          const repo = yield* OrgVaultRepo;
          const keyRepo = yield* UserEncryptionKeyRepo;

          const key = yield* keyRepo.findById({ id: payload.wrap.userEncryptionKeyId });
          if (isForeignOrgKey(key, ctx)) {
            return yield* Effect.fail(new BadRequest({ message: FOREIGN_ORG_KEY_MESSAGE }));
          }

          // Self-link (adding your OWN new device) is self-service for any member;
          // wrapping to anyone/anything else is a grant gated to admin/owner.
          const isSelfLink =
            key.kind === "device" && ctx.userId !== null && key.userId === ctx.userId;
          if (!isSelfLink) {
            yield* assertPermission("vaultAccess", "create");
          }

          // Reject early if the vault doesn't exist; `addWrap` itself CAS-guards the version.
          const vault = yield* repo.getVault({ organizationId: ctx.organizationId });
          if (vault === null) {
            return yield* Effect.fail(new NotFound({ message: "Vault not initialized" }));
          }

          const now = new Date().toISOString();
          const wrap = yield* repo.addWrap({
            organizationId: ctx.organizationId,
            vaultVersion: payload.vaultVersion,
            userEncryptionKeyId: payload.wrap.userEncryptionKeyId,
            wrappedKey: payload.wrap.wrappedKey,
            now,
          });

          yield* logAudit({
            action: "vault.wrap.add",
            resourceType: "vaultAccess",
            resourceId: payload.wrap.userEncryptionKeyId,
            metadata: { kind: key.kind, selfLink: isSelfLink, vaultVersion: payload.vaultVersion },
          });

          return toApiOrgVaultKeyWrap(wrap);
        }),
      ),
    )
    .handle("getWrap", ({ path }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertPermission("vaultAccess", "read");
          const ctx = yield* CurrentActor;
          const repo = yield* OrgVaultRepo;
          const keyRepo = yield* UserEncryptionKeyRepo;

          const key = yield* keyRepo.findById({ id: path.keyId });
          // Visible to the caller only if it's their own device or an org-owned key here.
          const isOwnDevice = ctx.userId !== null && key.userId === ctx.userId;
          const isOrgKey = key.organizationId === ctx.organizationId;
          if (!isOwnDevice && !isOrgKey) {
            return yield* Effect.fail(new NotFound({ message: "Encryption key not found" }));
          }

          const vault = yield* repo.getVault({ organizationId: ctx.organizationId });
          if (vault === null) {
            return yield* Effect.fail(new NotFound({ message: "Vault not initialized" }));
          }

          const wrap = yield* repo.findWrap({
            organizationId: ctx.organizationId,
            vaultVersion: vault.vaultVersion,
            userEncryptionKeyId: path.keyId,
          });
          if (wrap === null) {
            return yield* Effect.fail(
              new NotFound({ message: "No vault key wrap for this recipient — request access" }),
            );
          }

          return { vaultVersion: wrap.vaultVersion, wrappedKey: wrap.wrappedKey };
        }),
      ),
    )
    .handle("listCredentialDeks", () =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertPermission("vaultAccess", "read");
          const ctx = yield* CurrentActor;
          const repo = yield* OrgVaultRepo;
          const vault = yield* repo.getVault({ organizationId: ctx.organizationId });
          if (vault === null) {
            return yield* Effect.fail(new NotFound({ message: "Vault not initialized" }));
          }
          const deks = yield* repo.listCredentialDeks({ organizationId: ctx.organizationId });
          return { vaultVersion: vault.vaultVersion, deks };
        }),
      ),
    )
    .handle("rotate", ({ payload }) =>
      toApiWriteEffect(
        Effect.gen(function* () {
          // Revoke/rotate is a destructive admin op — it invalidates the old vault key.
          yield* assertPermission("vaultAccess", "delete");
          const ctx = yield* CurrentActor;
          const repo = yield* OrgVaultRepo;
          const keyRepo = yield* UserEncryptionKeyRepo;

          const recipientIds = payload.recipientWraps.map((wrap) => wrap.userEncryptionKeyId);
          const keys = yield* Effect.forEach(
            payload.recipientWraps,
            (wrap) => keyRepo.findById({ id: wrap.userEncryptionKeyId }),
            { concurrency: "unbounded" },
          );
          yield* assertRotationRecipients(keys, recipientIds, ctx);

          // Cheap precheck; `repo.rotate` re-checks the same version atomically via CAS.
          const vault = yield* repo.getVault({ organizationId: ctx.organizationId });
          if (vault === null) {
            return yield* Effect.fail(new NotFound({ message: "Vault not initialized" }));
          }
          if (vault.vaultVersion !== payload.fromVersion) {
            return yield* Effect.fail(
              new Conflict({ message: "Vault version changed since read; re-fetch and retry" }),
            );
          }

          const refs = yield* repo.listCredentialRefs({ organizationId: ctx.organizationId });
          yield* assertCoversAllCredentials(refs, payload.credentialDeks);

          // Capture the revoked recipients for the audit trail before the old
          // wraps are dropped.
          const previousWraps = yield* repo.listWraps({
            organizationId: ctx.organizationId,
            vaultVersion: payload.fromVersion,
          });
          const surviving = new Set(recipientIds);
          const removedRecipients = previousWraps
            .map((wrap) => wrap.userEncryptionKeyId)
            .filter((id) => !surviving.has(id));

          const now = new Date().toISOString();
          const rotated = yield* repo.rotate({
            organizationId: ctx.organizationId,
            fromVersion: payload.fromVersion,
            recipientWraps: payload.recipientWraps,
            credentialDeks: payload.credentialDeks,
            now,
          });

          yield* logAudit({
            action: "vault.rotate",
            resourceType: "vaultAccess",
            resourceId: ctx.organizationId,
            metadata: {
              fromVersion: payload.fromVersion,
              toVersion: rotated.vaultVersion,
              recipientCount: recipientIds.length,
              removedRecipients,
              credentialCount: payload.credentialDeks.length,
            },
          });

          return toApiOrgVault(rotated);
        }),
      ),
    ),
);
