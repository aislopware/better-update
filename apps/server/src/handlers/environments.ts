import { BUILTIN_ENVIRONMENTS, Environment } from "@better-update/api";
import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertPermission } from "../auth/permissions";
import { Conflict } from "../errors";
import { toApiEnvironment } from "../http/to-api";
import { toApiCrudEffect } from "../http/to-api-effect";
import { EnvironmentRepo } from "../repositories/environments";

const BUILTIN_NAMES: ReadonlySet<string> = new Set(BUILTIN_ENVIRONMENTS);

// Built-ins are virtual (never stored). Their `createdAt` is a fixed sentinel so
// the wire shape stays uniform with stored, user-defined environments.
const BUILTIN_CREATED_AT = "1970-01-01T00:00:00.000Z";

const toApiBuiltinEnvironment = (organizationId: string, name: string) =>
  new Environment({
    id: `builtin:${name}`,
    organizationId,
    name,
    isBuiltin: true,
    createdAt: BUILTIN_CREATED_AT,
  });

export const EnvironmentsGroupLive = HttpApiBuilder.group(
  ManagementApi,
  "environments",
  (handlers) =>
    handlers
      .handle("list", () =>
        toApiCrudEffect(
          Effect.gen(function* () {
            yield* assertPermission("environment", "read");
            const ctx = yield* CurrentActor;
            const repo = yield* EnvironmentRepo;
            const custom = yield* repo.listByOrg({ organizationId: ctx.organizationId });
            const builtins = BUILTIN_ENVIRONMENTS.map((name) =>
              toApiBuiltinEnvironment(ctx.organizationId, name),
            );
            return { items: [...builtins, ...custom.map(toApiEnvironment)] };
          }),
        ),
      )
      .handle("create", ({ payload }) =>
        toApiCrudEffect(
          Effect.gen(function* () {
            yield* assertPermission("environment", "create");
            const ctx = yield* CurrentActor;
            if (BUILTIN_NAMES.has(payload.name)) {
              return yield* new Conflict({
                message: `"${payload.name}" is a built-in environment`,
              });
            }
            const repo = yield* EnvironmentRepo;
            const id = crypto.randomUUID();
            const now = new Date().toISOString();
            yield* repo.insert({
              id,
              organizationId: ctx.organizationId,
              name: payload.name,
              createdAt: now,
            });
            yield* logAudit({
              action: "environment.create",
              resourceType: "environment",
              resourceId: id,
              metadata: { name: payload.name },
            });
            return toApiEnvironment({
              id,
              organizationId: ctx.organizationId,
              name: payload.name,
              createdAt: now,
            });
          }),
        ),
      )
      .handle("rename", ({ path, payload }) =>
        toApiCrudEffect(
          Effect.gen(function* () {
            yield* assertPermission("environment", "update");
            const ctx = yield* CurrentActor;
            if (BUILTIN_NAMES.has(path.name)) {
              return yield* new Conflict({
                message: `Built-in environment "${path.name}" cannot be renamed`,
              });
            }
            if (BUILTIN_NAMES.has(payload.name)) {
              return yield* new Conflict({
                message: `"${payload.name}" is a built-in environment`,
              });
            }
            const repo = yield* EnvironmentRepo;
            const existing = yield* repo.findByName({
              organizationId: ctx.organizationId,
              name: path.name,
            });
            yield* repo.rename({
              organizationId: ctx.organizationId,
              oldName: path.name,
              newName: payload.name,
            });
            yield* logAudit({
              action: "environment.rename",
              resourceType: "environment",
              resourceId: existing.id,
              metadata: { from: path.name, to: payload.name },
            });
            return toApiEnvironment({ ...existing, name: payload.name });
          }),
        ),
      )
      .handle("delete", ({ path }) =>
        toApiCrudEffect(
          Effect.gen(function* () {
            yield* assertPermission("environment", "delete");
            const ctx = yield* CurrentActor;
            if (BUILTIN_NAMES.has(path.name)) {
              return yield* new Conflict({
                message: `Built-in environment "${path.name}" cannot be deleted`,
              });
            }
            const repo = yield* EnvironmentRepo;
            const existing = yield* repo.findByName({
              organizationId: ctx.organizationId,
              name: path.name,
            });
            const usage = yield* repo.countEnvVarsUsing({
              organizationId: ctx.organizationId,
              name: path.name,
            });
            if (usage > 0) {
              return yield* new Conflict({
                message: `Cannot delete environment "${path.name}" while ${usage} variable(s) reference it`,
              });
            }
            yield* repo.deleteByName({ organizationId: ctx.organizationId, name: path.name });
            yield* logAudit({
              action: "environment.delete",
              resourceType: "environment",
              resourceId: existing.id,
              metadata: { name: path.name },
            });
            return { deleted: 1 };
          }),
        ),
      ),
);
