import { Authentication } from "@better-update/api";
import { isRecord } from "@better-update/type-guards";
import { HttpServerRequest } from "@effect/platform";
import { Effect, Layer, Redacted } from "effect";

import { createAuth } from "../auth";
import { cloudflareEnv } from "../cloudflare/context";
import { Forbidden, Unauthorized } from "../errors";
import { OrgRoleRepo, OrgRoleRepoLive } from "../repositories/org-role-repo";
import { API_KEY_PREFIX } from "./constants";
import { permissions } from "./permissions";
import { roleIsSuperadmin } from "./superadmin";

import type {
  Action,
  BuiltinRole,
  EffectivePermissions as ModelsEffectivePermissions,
  Resource,
} from "../models";
import type { AuthContextShape, EffectivePermissions } from "./context";

// ── Plugin API facade (types not inferred from betterAuth config) ──

interface VerifyApiKeyResult {
  valid: boolean;
  error: { message: string; code: string } | null;
  key: {
    referenceId: string;
    permissions: Record<string, string[]> | null;
  } | null;
}

interface ActiveMember {
  id: string;
  role: string;
  userId: string;
  organizationId: string;
}

interface SessionResult {
  session: Record<string, unknown>;
  user: { id: string; name: string; email: string };
}

interface BetterAuthApi {
  readonly verifyApiKey: (opts: { body: { key: string } }) => Promise<VerifyApiKeyResult>;
  readonly getSession: (opts: { headers: Headers }) => Promise<SessionResult | null>;
  readonly getActiveMember: (opts: { headers: Headers }) => Promise<ActiveMember | null>;
}

// Better Auth's api object is inferred from the plugin set at runtime. We
// Assert the expected shape once per isolate; if a plugin is removed, this
// Throws at first use and the error surfaces as a request failure — cleaner
// Than silently returning a generic Unauthorized per call.
const assertBetterAuthApi = (api: unknown): BetterAuthApi => {
  if (
    !isRecord(api) ||
    typeof api["verifyApiKey"] !== "function" ||
    typeof api["getSession"] !== "function" ||
    typeof api["getActiveMember"] !== "function"
  ) {
    // eslint-disable-next-line functional/no-throw-statements -- bootstrap invariant; plugin misconfiguration is unrecoverable
    throw new Error(
      "Better Auth api is missing expected plugin methods (verifyApiKey / getSession / getActiveMember)",
    );
  }
  // eslint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- runtime shape validated above; BetterAuthApi narrows Better Auth's opaque plugin object
  return api as unknown as BetterAuthApi;
};

const authApi = Effect.gen(function* () {
  const env = yield* cloudflareEnv;
  return assertBetterAuthApi(createAuth(env).api);
});

const getApiErrorMessage = (value: unknown): string | null =>
  isRecord(value) && typeof value["message"] === "string" ? value["message"] : null;

const verifyApiKey = (key: string) =>
  Effect.gen(function* () {
    const api = yield* authApi;
    return yield* Effect.tryPromise({
      try: async () => api.verifyApiKey({ body: { key } }),
      catch: () => new Unauthorized({ message: "API key verification failed" }),
    });
  });

const getSession = (headers: Headers) =>
  Effect.gen(function* () {
    const api = yield* authApi;
    return yield* Effect.tryPromise({
      try: async () => api.getSession({ headers }),
      catch: () => new Unauthorized({ message: "Session verification failed" }),
    });
  });

const getActiveMember = (headers: Headers) =>
  Effect.gen(function* () {
    const api = yield* authApi;
    return yield* Effect.tryPromise({
      try: async () => api.getActiveMember({ headers }),
      catch: () =>
        new Unauthorized({
          message: "Not a member of the active organization",
        }),
    });
  });

// ── Approval gate ─────────────────────────────────────────────────

interface UserAuthState {
  readonly approved: boolean;
  readonly isSuperadmin: boolean;
}

// Read the gate state straight from D1 rather than the session object: the
// compact cookie cache may omit custom user fields (`approved`) and the Better
// Auth `admin` plugin role, so trusting it risks a stale/missing value. A
// single PK lookup per request, alongside the existing `getActiveMember` read.
const getUserAuthState = (userId: string) =>
  Effect.gen(function* () {
    const env = yield* cloudflareEnv;
    const row = yield* Effect.tryPromise({
      try: async () =>
        env.DB.prepare(`SELECT "approved", "role" FROM "user" WHERE "id" = ?`)
          .bind(userId)
          .first<{ approved: number | null; role: string | null }>(),
      catch: () => new Unauthorized({ message: "Failed to resolve account state" }),
    });
    return {
      approved: row?.approved === 1,
      isSuperadmin: roleIsSuperadmin(row?.role),
    } satisfies UserAuthState;
  });

// ── Helpers ────────────────────────────────────────────────────────

const toStandardHeaders = (headers: Readonly<Record<string, string | undefined>>): Headers =>
  Object.entries(headers).reduce((result, [key, value]) => {
    if (value !== undefined) {
      result.set(key, value);
    }
    return result;
  }, new Headers());

// Built-in vs custom role switch (NOT an accept/reject gate). Built-in names
// resolve from the static `permissions` map with zero queries; any other name is
// a custom (dynamic-AC) role read from `organization_role`.
const isBuiltinRole = (value: string): value is BuiltinRole =>
  ["owner", "admin", "developer", "viewer"].includes(value);

// Union one role's resource->actions map into the accumulating set map. Keeps the
// `Resource` key type end-to-end: `Object.entries` widens keys to `string`, so we
// recover the original key type via a single contained assertion (a known TS
// structural-typing limitation, not a runtime risk — the source is already typed
// `Partial<Record<Resource, …>>`).
const mergePermissionMap = (
  into: Map<Resource, Set<Action>>,
  source: Partial<Record<Resource, readonly Action[]>>,
): void => {
  // eslint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Object.entries widens keys to string; source is already typed Partial<Record<Resource, Action[]>>
  const entries = Object.entries(source) as [Resource, readonly Action[]][];
  entries.forEach(([resource, actions]) => {
    const existing = into.get(resource) ?? new Set<Action>();
    actions.forEach((action) => existing.add(action));
    into.set(resource, existing);
  });
};

// Resolve a member's `effectivePermissions` ONCE per request, caching it into the
// auth context. `member.role` may be a built-in name, a custom-role name, or a
// comma-joined list (better-auth allows multi-role). Built-in names map straight
// from `permissions` (no query); each non-built-in name costs one
// `organization_role` read, merged onto any same-named built-in.
//
// Exported (with `OrgRoleRepo` as an unresolved requirement) so the resolution
// algorithm can be unit-tested against a stubbed repo; the live repo is provided
// at the single call site in `resolveSession` so the requirement never leaks into
// `ApiLive`.
export const resolveEffectivePermissions = (params: {
  readonly organizationId: string;
  readonly roleSpec: string;
}) =>
  Effect.gen(function* () {
    const repo = yield* OrgRoleRepo;
    const names = params.roleSpec
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
    const merged = yield* Effect.reduce(names, new Map<Resource, Set<Action>>(), (acc, name) =>
      Effect.gen(function* () {
        const builtin = isBuiltinRole(name) ? permissions[name] : undefined;
        // Skip the custom read for pure built-in names (strict zero-query path).
        const custom = builtin
          ? null
          : yield* repo.findByName({ organizationId: params.organizationId, role: name });
        // An unknown role name (neither built-in nor a stored custom role)
        // contributes nothing to the merged permission set.
        const source = builtin ?? custom;
        if (source) {
          mergePermissionMap(acc, source);
        }
        return acc;
      }),
    );
    return [...merged].reduce<ModelsEffectivePermissions>((out, [resource, set]) => {
      out[resource] = [...set];
      return out;
    }, {});
  });

// ── Shared session resolver ───────────────────────────────────────

// Resolve a Better Auth session from the request headers, regardless of which
// transport carried it. The `bearer()` plugin rewrites `Authorization: Bearer
// <session-token>` into the session cookie before `getSession` runs, so this
// serves both the browser (cookie) and the CLI (bearer session token); only the
// `transport` tag differs.
const resolveSession = (transport: "bearer" | "cookie") =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const headers = toStandardHeaders(request.headers);

    const session = yield* getSession(headers);

    if (!session) {
      return yield* new Unauthorized({ message: "Invalid session" });
    }

    // Dev-phase gate: a valid session is not enough — the user must be approved
    // by a superadmin (superadmins are implicitly allowed). Checked before the
    // active-org requirement so unapproved users are blocked uniformly, with or
    // without an organization.
    const authState = yield* getUserAuthState(session.user.id);
    if (!authState.approved && !authState.isSuperadmin) {
      return yield* new Forbidden({
        message: "Account pending superadmin approval",
      });
    }

    const rawOrgId = session.session["activeOrganizationId"];
    const orgId = typeof rawOrgId === "string" ? rawOrgId : undefined;
    if (!orgId) {
      return yield* new Unauthorized({
        message: "No active organization selected",
      });
    }

    const member = yield* getActiveMember(headers);

    if (!member) {
      return yield* new Unauthorized({
        message: "Not a member of the active organization",
      });
    }

    // Resolve effective permissions HERE, once per request, for built-in AND
    // custom roles; cache the result into the context. A member with a valid
    // custom role is accepted (the old `isRole` whitelist is gone).
    const effectivePermissions = yield* resolveEffectivePermissions({
      organizationId: orgId,
      roleSpec: member.role,
    }).pipe(Effect.provide(OrgRoleRepoLive));

    return {
      userId: session.user.id,
      organizationId: orgId,
      memberId: member.id,
      role: member.role,
      effectivePermissions,
      source: "session",
      transport,
      actorEmail: session.user.email,
      isSuperadmin: authState.isSuperadmin,
    } as const satisfies AuthContextShape;
  });

// ── Bearer: API key (CI) or session token (CLI) ───────────────────

// One Authorization-bearer handler for both machine credentials. Tokens with
// the configured API-key prefix resolve to an org-scoped, user-less actor;
// anything else is treated as a Better Auth session token (the CLI's login
// token) and resolved as a real user session via the `bearer()` plugin. An
// empty token fails so Effect's security middleware falls through to the cookie
// scheme (the browser dashboard).
const resolveFromBearer = (token: Redacted.Redacted) => {
  const key = Redacted.value(token);
  if (key.length === 0) {
    return Effect.fail(new Unauthorized({ message: "Missing bearer token" }));
  }

  if (!key.startsWith(API_KEY_PREFIX)) {
    return resolveSession("bearer");
  }

  return verifyApiKey(key).pipe(
    Effect.flatMap((result) => {
      if (!result.valid || !result.key) {
        return Effect.fail(
          new Unauthorized({
            message: getApiErrorMessage(result.error) ?? "Invalid API key",
          }),
        );
      }

      const keyPermissions: EffectivePermissions = result.key.permissions ?? permissions.admin;

      return Effect.succeed({
        userId: null,
        organizationId: result.key.referenceId,
        memberId: null,
        role: null,
        effectivePermissions: keyPermissions,
        source: "api-key",
        transport: "bearer",
        actorEmail: "api-key",
        isSuperadmin: false,
      } as const satisfies AuthContextShape);
    }),
  );
};

// ── Cookie (browser session) ──────────────────────────────────────

const resolveFromSession = (_cookie: Redacted.Redacted) => resolveSession("cookie");

// ── Layer ──────────────────────────────────────────────────────────

export const AuthenticationLive = Layer.succeed(Authentication, {
  bearer: resolveFromBearer,
  cookie: resolveFromSession,
});
