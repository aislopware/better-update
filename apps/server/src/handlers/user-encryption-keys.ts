import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertPermission } from "../auth/permissions";
import { isAllowed } from "../auth/policy-match";
import { BadRequest } from "../errors";
import { toApiCrudEffect, toApiWriteEffect } from "../http/to-api-effect";
import { toApiUserEncryptionKey } from "../http/to-api-vault";
import { UserEncryptionKeyRepo } from "../repositories/user-encryption-keys";

export const UserEncryptionKeysGroupLive = HttpApiBuilder.group(
  ManagementApi,
  "userEncryptionKeys",
  (handlers) =>
    handlers
      .handle("list", () =>
        toApiCrudEffect(
          Effect.gen(function* () {
            yield* assertPermission("vaultAccess", "read");
            const ctx = yield* CurrentActor;
            const repo = yield* UserEncryptionKeyRepo;
            // Admins/owners (vaultAccess:create) grant the vault to other members'
            // device keys, so they see every grantable recipient in the org;
            // everyone else sees only org-owned keys plus their own devices.
            const canGrant =
              ctx.isSuperadmin ||
              ctx.isOwner ||
              isAllowed(ctx.effectiveStatements, "vaultAccess:create", "org");
            const items = yield* canGrant
              ? repo.listGrantable({ organizationId: ctx.organizationId })
              : repo.listForActor({ organizationId: ctx.organizationId, userId: ctx.userId });
            return { items: items.map(toApiUserEncryptionKey) };
          }),
        ),
      )
      .handle("register", ({ payload }) =>
        toApiWriteEffect(
          Effect.gen(function* () {
            const ctx = yield* CurrentActor;
            const repo = yield* UserEncryptionKeyRepo;

            // A `device` key is the caller's own (self-service, needs an interactive
            // user); `recovery`/`machine` keys are org-owned and admin/owner-gated.
            const isDevice = payload.kind === "device";
            if (isDevice) {
              // Enrolling a device key makes the caller a vault recipient
              // candidate (it lands in `listGrantable` + is self-linkable). Gate
              // it on the same read capability the vault requires, so a principal
              // with no vault access (e.g. viewer) can't plant a recipient key.
              yield* assertPermission("vaultAccess", "read");
              if (ctx.userId === null) {
                return yield* new BadRequest({
                  message: "Device keys require an interactive user session",
                });
              }
            } else {
              yield* assertPermission("vaultAccess", "create");
            }

            const id = crypto.randomUUID();
            const now = new Date().toISOString();
            const userId = isDevice ? ctx.userId : null;
            const organizationId = isDevice ? null : ctx.organizationId;

            yield* repo.insert({
              id,
              userId,
              organizationId,
              kind: payload.kind,
              publicKey: payload.publicKey,
              label: payload.label,
              fingerprint: payload.fingerprint,
              createdAt: now,
            });

            yield* logAudit({
              action: "vault.encryption-key.register",
              resourceType: "vaultAccess",
              resourceId: id,
              metadata: { kind: payload.kind, fingerprint: payload.fingerprint },
            });

            return toApiUserEncryptionKey({
              id,
              userId,
              organizationId,
              kind: payload.kind,
              publicKey: payload.publicKey,
              label: payload.label,
              fingerprint: payload.fingerprint,
              createdAt: now,
              lastUsedAt: null,
              revokedAt: null,
            });
          }),
        ),
      ),
);
