import { CreatedRobotAccount, RobotAccount, RotatedRobotAccountBearer } from "@better-update/api";
import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertAccess, assertOrgAdmin } from "../auth/policy";
import { effectiveProjectRole, projectRoleAtLeast } from "../auth/role-matrix";
import { NotFound } from "../errors";
import { toApiCrudEffect, toApiReadEffect } from "../http/to-api-effect";
import { ProjectRepo } from "../repositories/projects";
import { RobotAccountRepo } from "../repositories/robot-accounts";

import type { CurrentActor as CurrentActorModel } from "../models";
import type { RobotAccountModel } from "../repositories/robot-accounts";

const toRobotAccount = (model: RobotAccountModel): RobotAccount =>
  new RobotAccount({
    id: model.id,
    organizationId: model.organizationId,
    name: model.name,
    bearerStart: model.bearerStart,
    hasBearer: model.hasBearer,
    userEncryptionKeyId: model.userEncryptionKeyId,
    projectId: model.projectId,
    role: model.role,
    createdAt: model.createdAt,
  });

// A robot is project-scoped (GITLAB-RBAC-SPEC §1b, v2): managing it requires
// Maintainer+ on ITS project. Legacy pre-v2 rows (projectId null) fall back
// to the org-admin gate — they exist only to be revoked.
const assertRobotManageable = (target: RobotAccountModel) =>
  target.projectId === null
    ? assertOrgAdmin
    : assertAccess("robotAccount", "update", { kind: "project", projectId: target.projectId });

const canSeeRobot = (ctx: CurrentActorModel, robot: RobotAccountModel): boolean =>
  robot.projectId !== null &&
  projectRoleAtLeast(effectiveProjectRole(ctx, robot.projectId), "maintainer");

export const RobotAccountsGroupLive = HttpApiBuilder.group(
  ManagementApi,
  "robot-accounts",
  (handlers) =>
    handlers
      .handle("list", ({ urlParams }) =>
        toApiReadEffect(
          Effect.gen(function* () {
            const ctx = yield* CurrentActor;
            const repo = yield* RobotAccountRepo;
            const accounts = yield* repo.list({
              organizationId: ctx.organizationId,
              projectId: urlParams.projectId,
            });
            // Admin tier sees every robot (incl. legacy unassigned rows);
            // otherwise the list scopes to projects the actor maintains —
            // the same rank that could rotate/revoke them.
            if (ctx.isSuperadmin || ctx.isOwner || ctx.orgRole === "admin") {
              return { items: accounts.map(toRobotAccount) };
            }
            const visible = accounts.filter((robot) => canSeeRobot(ctx, robot));
            return { items: visible.map(toRobotAccount) };
          }),
        ),
      )
      .handle("create", ({ payload }) =>
        toApiCrudEffect(
          Effect.gen(function* () {
            // Maintainer of the target project mints the robot (GitLab
            // project-access-token shape, spec §1b v2). The machine-kind key
            // row registered alongside is only a RECIPIENT IDENTITY — it can
            // decrypt nothing until a vault member (org admin) wraps the
            // vault key to it, so no vaultAccess gate is needed here.
            yield* assertAccess("robotAccount", "create", {
              kind: "project",
              projectId: payload.projectId,
            });
            const ctx = yield* CurrentActor;

            // Cross-org project ids surface as NotFound (enumeration-safe).
            const project = yield* (yield* ProjectRepo).findById({ id: payload.projectId });
            if (project.organizationId !== ctx.organizationId) {
              return yield* new NotFound({ message: "Project not found" });
            }

            // The repo mints the machine-kind vault recipient and the robot row
            // in one atomic D1 batch — no orphaned recipient on partial failure.
            const repo = yield* RobotAccountRepo;
            const created = yield* repo.create({
              organizationId: ctx.organizationId,
              name: payload.name,
              projectId: payload.projectId,
              role: payload.role,
              publicKey: payload.publicKey,
              fingerprint: payload.fingerprint,
            });

            yield* logAudit({
              action: "robotAccount.create",
              resourceType: "robotAccount",
              resourceId: created.model.id,
              metadata: {
                name: payload.name,
                fingerprint: payload.fingerprint,
                projectId: payload.projectId,
                role: payload.role,
              },
            });

            return new CreatedRobotAccount({
              id: created.model.id,
              organizationId: created.model.organizationId,
              name: created.model.name,
              bearerStart: created.model.bearerStart,
              hasBearer: created.model.hasBearer,
              userEncryptionKeyId: created.model.userEncryptionKeyId,
              projectId: payload.projectId,
              role: payload.role,
              createdAt: created.model.createdAt,
              bearerSecret: created.bearerSecret,
            });
          }),
        ),
      )
      .handle("rotate", ({ path }) =>
        toApiReadEffect(
          Effect.gen(function* () {
            const ctx = yield* CurrentActor;
            const repo = yield* RobotAccountRepo;
            const target = yield* repo.findById({
              id: path.id,
              organizationId: ctx.organizationId,
            });
            // Rotating hands out the robot's NEW bearer — an identity
            // takeover — so it takes the same rank that could mint it:
            // Maintainer on its project (admin for legacy rows). A robot can
            // never escalate this way: the rotated identity holds at most
            // maintainer on the same single project.
            yield* assertRobotManageable(target);
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
            const ctx = yield* CurrentActor;
            const repo = yield* RobotAccountRepo;
            const target = yield* repo.findById({
              id: path.id,
              organizationId: ctx.organizationId,
            });
            yield* assertRobotManageable(target);
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
