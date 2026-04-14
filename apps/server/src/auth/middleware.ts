import { Authentication } from "@better-update/api";
import { HttpServerRequest } from "@effect/platform";
import { Effect, Layer, Redacted } from "effect";

import { createAuth } from "../auth";
import { cloudflareEnv } from "../cloudflare/context";
import { Unauthorized } from "../errors";
import { API_KEY_PREFIX } from "./constants";
import { permissions } from "./permissions";

import type { AuthContextShape, EffectivePermissions, Role } from "./context";

// ── Plugin API helpers (types not inferred from betterAuth config) ─

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isVerifyApiKeyApi = (
  value: unknown,
): value is {
  verifyApiKey: (opts: { body: { key: string } }) => Promise<VerifyApiKeyResult>;
} => isRecord(value) && typeof value["verifyApiKey"] === "function";

const isSessionApi = (
  value: unknown,
): value is {
  getSession: (opts: { headers: Headers }) => Promise<SessionResult | null>;
} => isRecord(value) && typeof value["getSession"] === "function";

const isActiveMemberApi = (
  value: unknown,
): value is {
  getActiveMember: (opts: { headers: Headers }) => Promise<ActiveMember | null>;
} => isRecord(value) && typeof value["getActiveMember"] === "function";

const getApiErrorMessage = (value: unknown): string | null =>
  isRecord(value) && typeof value["message"] === "string" ? value["message"] : null;

const verifyApiKey = (key: string) =>
  Effect.gen(function* () {
    const env = yield* cloudflareEnv;
    const { api } = createAuth(env);
    if (!isVerifyApiKeyApi(api)) {
      return yield* new Unauthorized({ message: "API key verification failed" });
    }
    return yield* Effect.tryPromise({
      try: async () => api.verifyApiKey({ body: { key } }),
      catch: () => new Unauthorized({ message: "API key verification failed" }),
    });
  });

const getSession = (headers: Headers) =>
  Effect.gen(function* () {
    const env = yield* cloudflareEnv;
    const { api } = createAuth(env);
    if (!isSessionApi(api)) {
      return yield* new Unauthorized({ message: "Session verification failed" });
    }
    return yield* Effect.tryPromise({
      try: async () => api.getSession({ headers }),
      catch: () => new Unauthorized({ message: "Session verification failed" }),
    });
  });

const getActiveMember = (headers: Headers) =>
  Effect.gen(function* () {
    const env = yield* cloudflareEnv;
    const { api } = createAuth(env);
    if (!isActiveMemberApi(api)) {
      return yield* new Unauthorized({
        message: "Not a member of the active organization",
      });
    }
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

      const keyPermissions: EffectivePermissions = result.key.permissions ?? permissions.owner;

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

    if (!isRole(member.role)) {
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
