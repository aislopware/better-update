import { Authentication } from "@better-update/api";
import { isRecord } from "@better-update/type-guards";
import { HttpServerRequest } from "@effect/platform";
import { Effect, Layer, Redacted } from "effect";

import { createAuth } from "../auth";
import { cloudflareEnv } from "../cloudflare/context";
import { Unauthorized } from "../errors";
import { API_KEY_PREFIX } from "./constants";
import { permissions } from "./permissions";

import type { AuthContextShape, EffectivePermissions, Role } from "./context";

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

// ── Helpers ────────────────────────────────────────────────────────

const toStandardHeaders = (headers: Readonly<Record<string, string | undefined>>): Headers =>
  Object.entries(headers).reduce((result, [key, value]) => {
    if (value !== undefined) {
      result.set(key, value);
    }
    return result;
  }, new Headers());

const isRole = (value: string): value is Role =>
  ["owner", "admin", "developer", "viewer"].includes(value);

// ── Bearer (API key) ──────────────────────────────────────────────

// Only keys matching the configured default prefix are accepted.
// Custom prefixes are not supported — the create endpoint always uses API_KEY_PREFIX.
const resolveFromApiKey = (token: Redacted.Redacted) => {
  const key = Redacted.value(token);
  if (!key.startsWith(API_KEY_PREFIX)) {
    return Effect.fail(new Unauthorized({ message: "Not an API key" }));
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
        role: null,
        effectivePermissions: keyPermissions,
        source: "api-key",
        actorEmail: "api-key",
      } as const satisfies AuthContextShape);
    }),
  );
};

// ── Cookie (session) ──────────────────────────────────────────────

const resolveFromSession = (_cookie: Redacted.Redacted) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const headers = toStandardHeaders(request.headers);

    const session = yield* getSession(headers);

    if (!session) {
      return yield* new Unauthorized({ message: "Invalid session" });
    }

    const rawOrgId = session.session["activeOrganizationId"];
    const orgId = typeof rawOrgId === "string" ? rawOrgId : undefined;
    if (!orgId) {
      return yield* new Unauthorized({
        message: "No active organization selected",
      });
    }

    const member = yield* getActiveMember(headers);

    if (!member || !isRole(member.role)) {
      return yield* new Unauthorized({
        message: "Not a member of the active organization",
      });
    }

    return {
      userId: session.user.id,
      organizationId: orgId,
      role: member.role,
      effectivePermissions: permissions[member.role],
      source: "session",
      actorEmail: session.user.email,
    } as const satisfies AuthContextShape;
  });

// ── Layer ──────────────────────────────────────────────────────────

export const AuthenticationLive = Layer.succeed(Authentication, {
  bearer: resolveFromApiKey,
  cookie: resolveFromSession,
});
