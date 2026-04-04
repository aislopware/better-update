import { HttpApiMiddleware, HttpApiSecurity, HttpServerRequest } from "@effect/platform";
import { Effect, Layer, Redacted } from "effect";

import { createAuth } from "../auth";
import { getEnv } from "../cloudflare/context";
import { API_KEY_PREFIX } from "./constants";
import { AuthContext } from "./context";
import { Unauthorized } from "./errors";
import { permissions } from "./permissions";

import type { AuthContextShape, EffectivePermissions, Role } from "./context";

const bearerSecurity = HttpApiSecurity.bearer;
const cookieSecurity = HttpApiSecurity.apiKey({
  key: "__Secure-better-auth.session_token",
  in: "cookie",
});

export class Authentication extends HttpApiMiddleware.Tag<Authentication>()("api/Authentication", {
  failure: Unauthorized,
  provides: AuthContext,
  security: { bearer: bearerSecurity, cookie: cookieSecurity },
}) {}

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

/* eslint-disable typescript/no-unsafe-type-assertion -- plugin API types not inferred from betterAuth config */

const verifyApiKey = async (key: string): Promise<VerifyApiKeyResult> =>
  (
    createAuth(getEnv()).api as unknown as {
      verifyApiKey: (opts: { body: { key: string } }) => Promise<VerifyApiKeyResult>;
    }
  ).verifyApiKey({ body: { key } });

const getSession = async (headers: Headers): Promise<SessionResult | null> =>
  (
    createAuth(getEnv()).api as unknown as {
      getSession: (opts: { headers: Headers }) => Promise<SessionResult | null>;
    }
  ).getSession({ headers });

const getActiveMember = async (headers: Headers): Promise<ActiveMember | null> =>
  (
    createAuth(getEnv()).api as unknown as {
      getActiveMember: (opts: { headers: Headers }) => Promise<ActiveMember | null>;
    }
  ).getActiveMember({ headers });

/* eslint-enable typescript/no-unsafe-type-assertion */

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

  return Effect.tryPromise({
    try: async () => verifyApiKey(key),
    catch: () => new Unauthorized({ message: "API key verification failed" }),
  }).pipe(
    Effect.flatMap((result) => {
      if (!result.valid || !result.key) {
        return Effect.fail(
          new Unauthorized({
            message: result.error?.message ?? "Invalid API key",
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
      } as const satisfies AuthContextShape);
    }),
  );
};

// ── Cookie (session) ──────────────────────────────────────────────

const resolveFromSession = (_cookie: Redacted.Redacted) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const headers = toStandardHeaders(request.headers);

    const session = yield* Effect.tryPromise({
      try: async () => getSession(headers),
      catch: () => new Unauthorized({ message: "Session verification failed" }),
    });

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

    const member = yield* Effect.tryPromise({
      try: async () => getActiveMember(headers),
      catch: () =>
        new Unauthorized({
          message: "Not a member of the active organization",
        }),
    });

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
    } as const satisfies AuthContextShape;
  });

// ── Layer ──────────────────────────────────────────────────────────

export const AuthenticationLive = Layer.succeed(Authentication, {
  bearer: resolveFromApiKey,
  cookie: resolveFromSession,
});
