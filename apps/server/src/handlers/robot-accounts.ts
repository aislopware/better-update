import { CreatedRobotAccount, RobotAccount, RotatedRobotAccountBearer } from "@better-update/api";
import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertPermission } from "../auth/permissions";
import { assertAccess } from "../auth/policy";
import { isWithinBoundary } from "../auth/policy-boundary";
import { statementsForPrincipals } from "../auth/statements";
import { Forbidden, NotFound } from "../errors";
import { toApiCrudEffect, toApiReadEffect } from "../http/to-api-effect";
import { RobotAccountRepo } from "../repositories/robot-accounts";

import type { RobotAccountModel } from "../repositories/robot-accounts";

const toRobotAccount = (model: RobotAccountModel): RobotAccount =>
  new RobotAccount({
    id: model.id,
    organizationId: model.organizationId,
    name: model.name,
    bearerStart: model.bearerStart,
    hasBearer: model.hasBearer,
    userEncryptionKeyId: model.userEncryptionKeyId,
    createdAt: model.createdAt,
  });

export const RobotAccountsGroupLive = HttpApiBuilder.group(
  ManagementApi,
  "robot-accounts",
  (handlers) =>
    handlers
      .handle("list", () =>
        toApiReadEffect(
          Effect.gen(function* () {
            yield* assertAccess("robotAccount", "read");
            const ctx = yield* CurrentActor;
            const repo = yield* RobotAccountRepo;
            const accounts = yield* repo.list({ organizationId: ctx.organizationId });
            return { items: accounts.map(toRobotAccount) };
          }),
        ),
      )
      .handle("create", ({ payload }) =>
        toApiCrudEffect(
          Effect.gen(function* () {
            // The row+bearer and the vault-recipient registration are two
            // distinct privileges (mirroring the deleted apikey feature +
            // the vaultAccess:create gate the register endpoint enforced) — a
            // robot always gets both, so both are required up front rather than
            // silently degrading to a bearer-less account.
            yield* assertAccess("robotAccount", "create");
            yield* assertPermission("vaultAccess", "create");
            const ctx = yield* CurrentActor;

            // The repo mints the machine-kind vault recipient and the robot row
            // in one atomic D1 batch — no orphaned recipient on partial failure.
            const repo = yield* RobotAccountRepo;
            const created = yield* repo.create({
              organizationId: ctx.organizationId,
              name: payload.name,
              publicKey: payload.publicKey,
              fingerprint: payload.fingerprint,
            });

            yield* logAudit({
              action: "robotAccount.create",
              resourceType: "robotAccount",
              resourceId: created.model.id,
              metadata: { name: payload.name, fingerprint: payload.fingerprint },
            });

            return new CreatedRobotAccount({
              id: created.model.id,
              organizationId: created.model.organizationId,
              name: created.model.name,
              bearerStart: created.model.bearerStart,
              hasBearer: created.model.hasBearer,
              userEncryptionKeyId: created.model.userEncryptionKeyId,
              createdAt: created.model.createdAt,
              bearerSecret: created.bearerSecret,
            });
          }),
        ),
      )
      .handle("rotate", ({ path }) =>
        toApiReadEffect(
          Effect.gen(function* () {
            yield* assertAccess("robotAccount", "update");
            const ctx = yield* CurrentActor;
            // Permission boundary (no privilege escalation): rotating hands out
            // the target robot's NEW bearer — an identity takeover. A non-owner
            // may only rotate a robot whose attached grants are all within what
            // the caller itself holds; otherwise `robotAccount:update` alone
            // would be a ladder to any stronger robot's permissions.
            if (!ctx.isOwner && !ctx.isSuperadmin) {
              const granted = yield* statementsForPrincipals({
                organizationId: ctx.organizationId,
                principals: [{ type: "robot", id: path.id }],
              });
              if (!isWithinBoundary(ctx.effectiveStatements, { statements: granted })) {
                return yield* new Forbidden({
                  message: "Cannot rotate a robot that holds more than you currently hold",
                });
              }
            }
            const repo = yield* RobotAccountRepo;
            const rotated = yield* repo.rotateBearer({
              id: path.id,
              organizationId: ctx.organizationId,
            });
            yield* logAudit({
              action: "robotAccount.rotate",
              resourceType: "robotAccount",
              resourceId: path.id,
            });
            return new RotatedRobotAccountBearer({ bearerSecret: rotated.bearerSecret });
          }),
        ),
      )
      .handle("revoke", ({ path }) =>
        toApiReadEffect(
          Effect.gen(function* () {
            yield* assertAccess("robotAccount", "delete");
            const ctx = yield* CurrentActor;
            const repo = yield* RobotAccountRepo;
            const deleted = yield* repo.revoke({ id: path.id, organizationId: ctx.organizationId });
            if (!deleted) {
              return yield* new NotFound({ message: "Robot account not found" });
            }
            yield* logAudit({
              action: "robotAccount.delete",
              resourceType: "robotAccount",
              resourceId: path.id,
            });
            return { deleted: 1 };
          }),
        ),
      ),
);
