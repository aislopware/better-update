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
import { ProtectedEnvironmentRepo } from "../repositories/protected-environments";

const BUILTIN_NAMES: ReadonlySet<string> = new Set(BUILTIN_ENVIRONMENTS);

// Built-ins are virtual (never stored). Their `createdAt` is a fixed sentinel so
// the wire shape stays uniform with stored, user-defined environments.
const BUILTIN_CREATED_AT = "1970-01-01T00:00:00.000Z";

const toApiBuiltinEnvironment = (
  organizationId: string,
  name: string,
  protectedSet: ReadonlySet<string>,
) =>
  new Environment({
    id: `builtin:${name}`,
    organizationId,
    name,
    isBuiltin: true,
    protected: protectedSet.has(name),
    createdAt: BUILTIN_CREATED_AT,
  });

// Resolve a name to its Environment wire shape (built-in or stored row) so the
// protection endpoints can echo the updated entity. NotFound for unknown names.
const findEnvironment = (params: {
  readonly organizationId: string;
  readonly name: string;
  readonly protectedSet: ReadonlySet<string>;
}) =>
  Effect.gen(function* () {
    if (BUILTIN_NAMES.has(params.name)) {
      return toApiBuiltinEnvironment(params.organizationId, params.name, params.protectedSet);
    }
    const repo = yield* EnvironmentRepo;
    const stored = yield* repo.findByName({
      organizationId: params.organizationId,
      name: params.name,
    });
    return toApiEnvironment(stored, params.protectedSet.has(params.name));
  });

// Shared implementation of the protect/unprotect endpoints (SPEC §5c) — gated
// like environment management, audit-logged, idempotent.
const setProtection = (name: string, wantProtected: boolean) =>
  toApiCrudEffect(
    Effect.gen(function* () {
      yield* assertPermission("environment", "update");
      const ctx = yield* CurrentActor;
      const protectedRepo = yield* ProtectedEnvironmentRepo;
      const current = yield* protectedRepo.listByOrg({ organizationId: ctx.organizationId });
      // Echo with the DESIRED protection state; also validates existence so
      // protecting a typo'd name 404s instead of storing an inert row.
      const updated = new Set(current);
      if (wantProtected) {
        updated.add(name);
      } else {
        updated.delete(name);
      }
      const echo = yield* findEnvironment({
        organizationId: ctx.organizationId,
        name,
        protectedSet: updated,
      });
      if (current.has(name) !== wantProtected) {
        yield* wantProtected
          ? protectedRepo.protect({
              organizationId: ctx.organizationId,
              environment: name,
              createdAt: new Date().toISOString(),
            })
          : protectedRepo.unprotect({ organizationId: ctx.organizationId, environment: name });
        yield* logAudit({
          action: wantProtected ? "environment.protect" : "environment.unprotect",
          resourceType: "environment",
          resourceId: echo.id,
          metadata: { name },
        });
      }
      return echo;
    }),
  );

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
            const protectedRepo = yield* ProtectedEnvironmentRepo;
            const custom = yield* repo.listByOrg({ organizationId: ctx.organizationId });
            const protectedSet = yield* protectedRepo.listByOrg({
              organizationId: ctx.organizationId,
            });
            const builtins = BUILTIN_ENVIRONMENTS.map((name) =>
              toApiBuiltinEnvironment(ctx.organizationId, name, protectedSet),
            );
            return {
              items: [
                ...builtins,
                ...custom.map((env) => toApiEnvironment(env, protectedSet.has(env.name))),
              ],
            };
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
            return toApiEnvironment(
              {
                id,
                organizationId: ctx.organizationId,
                name: payload.name,
                createdAt: now,
              },
              false,
            );
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
            // Protection follows the name: a protected environment stays
            // protected across a rename.
            const protectedRepo = yield* ProtectedEnvironmentRepo;
            const protectedSet = yield* protectedRepo.listByOrg({
              organizationId: ctx.organizationId,
            });
            const wasProtected = protectedSet.has(path.name);
            if (wasProtected) {
              yield* protectedRepo.unprotect({
                organizationId: ctx.organizationId,
                environment: path.name,
              });
              yield* protectedRepo.protect({
                organizationId: ctx.organizationId,
                environment: payload.name,
                createdAt: new Date().toISOString(),
              });
            }
            yield* logAudit({
              action: "environment.rename",
              resourceType: "environment",
              resourceId: existing.id,
              metadata: { from: path.name, to: payload.name },
            });
            return toApiEnvironment({ ...existing, name: payload.name }, wasProtected);
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
            // Deleting an environment drops its protection row too — a future
            // environment reusing the name must opt back in explicitly.
            const protectedRepo = yield* ProtectedEnvironmentRepo;
            yield* protectedRepo.unprotect({
              organizationId: ctx.organizationId,
              environment: path.name,
            });
            yield* logAudit({
              action: "environment.delete",
              resourceType: "environment",
              resourceId: existing.id,
              metadata: { name: path.name },
            });
            return { deleted: 1 };
          }),
        ),
      )
      .handle("protect", ({ path }) => setProtection(path.name, true))
      .handle("unprotect", ({ path }) => setProtection(path.name, false)),
);
