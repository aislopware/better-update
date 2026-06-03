import { isRecord } from "@better-update/type-guards";
import { HttpApiBuilder, HttpServerRequest } from "@effect/platform";
import { Effect } from "effect";

import type { OrgRole as OrgRoleSchema } from "@better-update/api";

import { ManagementApi } from "../api";
import { createAuth } from "../auth";
import { CurrentActor } from "../auth/current-actor";
import { assertPermission } from "../auth/permissions";
import { cloudflareEnv } from "../cloudflare/context";
import { Conflict, Forbidden, NotFound } from "../errors";
import { toApiCrudEffect } from "../http/to-api-effect";

import type { Action, Resource } from "../models";

// ── Better Auth dynamic-AC facade ──────────────────────────────────
//
// The role-management endpoints (`organization` plugin, `dynamicAccessControl`)
// are not statically inferable from the betterAuth config. We assert the shape
// once per call, mirroring `auth/middleware.ts`. Each endpoint resolves the
// session from the forwarded request headers and re-checks `ac` permission;
// our `assertPermission("ac", …)` gate runs first for the uniform Forbidden
// shape (belt-and-suspenders with better-auth).

// One role row as better-auth returns it (permission already JSON-parsed to an
// object; `createdAt`/`updatedAt` serialise to ISO strings over the boundary).
interface OrgRoleRow {
  readonly id: string;
  readonly organizationId: string;
  readonly role: string;
  readonly permission: Record<string, readonly string[]>;
  readonly createdAt: string | Date;
  readonly updatedAt?: string | Date | null;
}

interface CreateOrgRoleInput {
  readonly body: {
    readonly organizationId: string;
    readonly role: string;
    readonly permission: Record<string, readonly string[]>;
  };
  readonly headers: Headers;
}

interface UpdateOrgRoleInput {
  readonly body: {
    readonly organizationId: string;
    readonly roleId: string;
    readonly data: {
      readonly permission?: Record<string, readonly string[]>;
      readonly roleName?: string;
    };
  };
  readonly headers: Headers;
}

interface OrgRoleApi {
  readonly createOrgRole: (input: CreateOrgRoleInput) => Promise<{ roleData: OrgRoleRow }>;
  readonly listOrgRoles: (input: {
    query: { organizationId: string };
    headers: Headers;
  }) => Promise<readonly OrgRoleRow[]>;
  readonly getOrgRole: (input: {
    query: { roleId: string; organizationId: string };
    headers: Headers;
  }) => Promise<OrgRoleRow>;
  readonly updateOrgRole: (input: UpdateOrgRoleInput) => Promise<{ roleData: OrgRoleRow }>;
  readonly deleteOrgRole: (input: {
    body: { roleId: string; organizationId: string };
    headers: Headers;
  }) => Promise<{ success: boolean }>;
}

const assertOrgRoleApi = (api: unknown): OrgRoleApi => {
  if (
    !isRecord(api) ||
    typeof api["createOrgRole"] !== "function" ||
    typeof api["listOrgRoles"] !== "function" ||
    typeof api["getOrgRole"] !== "function" ||
    typeof api["updateOrgRole"] !== "function" ||
    typeof api["deleteOrgRole"] !== "function"
  ) {
    // eslint-disable-next-line functional/no-throw-statements -- bootstrap invariant; missing dynamic-AC endpoints means plugin misconfiguration
    throw new Error(
      "Better Auth api is missing dynamic-AC endpoints (createOrgRole / listOrgRoles / getOrgRole / updateOrgRole / deleteOrgRole)",
    );
  }
  // eslint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- runtime shape validated above; OrgRoleApi narrows Better Auth's opaque plugin object
  return api as unknown as OrgRoleApi;
};

const orgRoleApi = Effect.gen(function* () {
  const env = yield* cloudflareEnv;
  return assertOrgRoleApi(createAuth(env).api);
});

const requestHeaders = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  // Effect's `Headers.Headers` is a `Record<string, string>`; forward it verbatim
  // so Better Auth's dynamic-AC endpoints can resolve the caller's session.
  return new Headers(request.headers);
});

// ── Error mapping ──────────────────────────────────────────────────
//
// Better Auth throws a better-call `APIError` carrying a string `status`
// ("FORBIDDEN" / "NOT_FOUND" / "CONFLICT" / "BAD_REQUEST" / …) and a
// `body.message`. Map onto our CRUD error set; BAD_REQUEST collapses to
// Conflict so it stays representable in the contract's error union.
const mapAuthError = (error: unknown): Conflict | Forbidden | NotFound => {
  const status = isRecord(error) && typeof error["status"] === "string" ? error["status"] : "";
  const body = isRecord(error) ? error["body"] : undefined;
  const message =
    isRecord(body) && typeof body["message"] === "string"
      ? body["message"]
      : "Role operation failed";
  switch (status) {
    case "FORBIDDEN":
    case "UNAUTHORIZED": {
      return new Forbidden({ message });
    }
    case "NOT_FOUND": {
      return new NotFound({ message });
    }
    default: {
      // CONFLICT, BAD_REQUEST (invalid resource / too many roles / role taken /
      // role assigned to members / role not found), and anything else.
      return new Conflict({ message });
    }
  }
};

// ── Mappers ────────────────────────────────────────────────────────

const toIsoString = (value: string | Date | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : value;
};

const toApiOrgRole = (row: OrgRoleRow): OrgRoleSchema => ({
  id: row.id,
  organizationId: row.organizationId,
  role: row.role,
  permissions: Object.entries(row.permission).map(([resource, actions]) => ({
    resource,
    actions: [...actions],
  })),
  createdAt: toIsoString(row.createdAt) ?? new Date().toISOString(),
  updatedAt: toIsoString(row.updatedAt),
});

// Contract `permissions: { resource, actions }[]` -> better-auth
// `permission: Record<resource, actions[]>`.
const toPermissionRecord = (
  permissions: readonly { readonly resource: string; readonly actions: readonly string[] }[],
): Record<string, readonly string[]> =>
  permissions.reduce<Record<string, readonly string[]>>((acc, grant) => {
    acc[grant.resource] = [...grant.actions];
    return acc;
  }, {});

// ── Group ──────────────────────────────────────────────────────────

export const OrgRolesGroupLive = HttpApiBuilder.group(ManagementApi, "roles", (handlers) =>
  handlers
    .handle("list", ({ urlParams }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertPermission("ac" satisfies Resource, "read" satisfies Action);
          const ctx = yield* CurrentActor;
          // Anti-enumeration: the listed org must be the caller's active org.
          if (urlParams.organizationId !== ctx.organizationId) {
            return yield* new NotFound({ message: "Organization not found" });
          }
          const api = yield* orgRoleApi;
          const headers = yield* requestHeaders;
          const rows = yield* Effect.tryPromise({
            try: async () =>
              api.listOrgRoles({ query: { organizationId: ctx.organizationId }, headers }),
            catch: mapAuthError,
          });
          return rows.map(toApiOrgRole);
        }),
      ),
    )
    .handle("create", ({ payload }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertPermission("ac" satisfies Resource, "create" satisfies Action);
          const ctx = yield* CurrentActor;
          const api = yield* orgRoleApi;
          const headers = yield* requestHeaders;
          const result = yield* Effect.tryPromise({
            try: async () =>
              api.createOrgRole({
                body: {
                  organizationId: ctx.organizationId,
                  role: payload.name,
                  permission: toPermissionRecord(payload.permissions),
                },
                headers,
              }),
            catch: mapAuthError,
          });
          return toApiOrgRole(result.roleData);
        }),
      ),
    )
    .handle("get", ({ path }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertPermission("ac" satisfies Resource, "read" satisfies Action);
          const ctx = yield* CurrentActor;
          const api = yield* orgRoleApi;
          const headers = yield* requestHeaders;
          const row = yield* Effect.tryPromise({
            try: async () =>
              api.getOrgRole({
                query: { roleId: path.id, organizationId: ctx.organizationId },
                headers,
              }),
            catch: mapAuthError,
          });
          return toApiOrgRole(row);
        }),
      ),
    )
    .handle("update", ({ path, payload }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertPermission("ac" satisfies Resource, "update" satisfies Action);
          const ctx = yield* CurrentActor;
          const api = yield* orgRoleApi;
          const headers = yield* requestHeaders;
          const result = yield* Effect.tryPromise({
            try: async () =>
              api.updateOrgRole({
                body: {
                  organizationId: ctx.organizationId,
                  roleId: path.id,
                  data: {
                    ...(payload.permissions === undefined
                      ? {}
                      : { permission: toPermissionRecord(payload.permissions) }),
                    ...(payload.name === undefined ? {} : { roleName: payload.name }),
                  },
                },
                headers,
              }),
            catch: mapAuthError,
          });
          return toApiOrgRole(result.roleData);
        }),
      ),
    )
    .handle("delete", ({ path }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertPermission("ac" satisfies Resource, "delete" satisfies Action);
          const ctx = yield* CurrentActor;
          const api = yield* orgRoleApi;
          const headers = yield* requestHeaders;
          yield* Effect.tryPromise({
            try: async () =>
              api.deleteOrgRole({
                body: { roleId: path.id, organizationId: ctx.organizationId },
                headers,
              }),
            catch: mapAuthError,
          });
          return { deleted: 1 };
        }),
      ),
    ),
);
