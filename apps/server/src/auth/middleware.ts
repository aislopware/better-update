import { Authentication } from "@better-update/api";
import { isRecord } from "@better-update/type-guards";
import { HttpServerRequest } from "@effect/platform";
import { Effect, Layer, Redacted } from "effect";

import { createAuth } from "../auth";
import { cloudflareEnv } from "../cloudflare/context";
import { Forbidden, Unauthorized } from "../errors";
import { GroupRepo, GroupRepoLive } from "../repositories/group-repo";
import {
  PolicyAttachmentRepo,
  PolicyAttachmentRepoLive,
} from "../repositories/policy-attachment-repo";
import { PolicyRepo, PolicyRepoLive } from "../repositories/policy-repo";
import { API_KEY_PREFIX } from "./constants";
import { isManagedPolicyId, resolveManagedDocument } from "./managed-policies";
import { roleIsOwner } from "./owner";
import { roleIsSuperadmin } from "./superadmin";

import type { PolicyStatement } from "../models";
import type { PrincipalRef } from "../repositories/policy-attachment-repo";
import type { AuthContextShape } from "./context";

const REPO_LAYERS = Layer.mergeAll(PolicyAttachmentRepoLive, GroupRepoLive, PolicyRepoLive);

// ── Plugin API facade (types not inferred from betterAuth config) ──

interface VerifyApiKeyResult {
  valid: boolean;
  error: { message: string; code: string } | null;
  key: {
    // The better-auth api-key row id; this is the `principal_id` stored by the
    // policy-attachment handlers for `principal_type = "apikey"`.
    id: string;
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

export const toStandardHeaders = (headers: Readonly<Record<string, string | undefined>>): Headers =>
  Object.entries(headers).reduce((result, [key, value]) => {
    if (value !== undefined) {
      result.set(key, value);
    }
    return result;
  }, new Headers());

// Flatten the policy statements granted by a set of principals' attachments.
// Managed preset ids resolve from code (zero query); real ids resolve in one
// batched read. Shared by the member path (self + groups) and the api-key path
// (self only) so both consult `policy_attachment` identically — no implicit
// baseline, no role-derived grants.
// Exported (with the policy repos as unresolved requirements) so the api-key
// positive-grant path can be integration-tested directly, mirroring
// `resolveEffectiveStatements` for the member path.
export const statementsForPrincipals = (params: {
  readonly organizationId: string;
  readonly principals: readonly PrincipalRef[];
}) =>
  Effect.gen(function* () {
    if (params.principals.length === 0) {
      return [] as readonly PolicyStatement[];
    }
    const attachRepo = yield* PolicyAttachmentRepo;
    const policyRepo = yield* PolicyRepo;

    const attachments = yield* attachRepo.findForPrincipals({
      organizationId: params.organizationId,
      principals: params.principals,
    });

    const policyIds = [...new Set(attachments.map((att) => att.policyId))];
    const realIds = policyIds.filter((id) => !isManagedPolicyId(id));
    const realDocs = yield* policyRepo.findDocumentsByIds({
      organizationId: params.organizationId,
      ids: realIds,
    });

    return policyIds.flatMap((id): readonly PolicyStatement[] => {
      const doc = isManagedPolicyId(id) ? resolveManagedDocument(id) : realDocs.get(id);
      return doc?.statements ?? [];
    });
  });

// Resolve a member's effective policy statements ONCE per request, caching the
// flat list into the auth context. Direct (member) attachments + group
// attachments; managed preset ids resolve from code (zero query), real ids in one
// batched read. Owners bypass entirely, so this is never called for them.
//
// No baseline is derived from `member.role` (spec §8 clean break): admin /
// developer / viewer are granted EXCLUSIVELY via explicit `managed:*`
// attachments. The free-form role string only feeds the `isOwner` root signal.
//
// Exported (with the policy repos as unresolved requirements) so the resolution
// algorithm can be unit-tested against stubbed repos; the live layers are
// provided at the single call site in `resolveSession`.
export const resolveEffectiveStatements = (params: {
  readonly organizationId: string;
  readonly memberId: string;
}) =>
  Effect.gen(function* () {
    const groupRepo = yield* GroupRepo;
    const groupIds = yield* groupRepo.findGroupIdsForMember({ memberId: params.memberId });
    const principals: readonly PrincipalRef[] = [
      { type: "member", id: params.memberId },
      ...groupIds.map((id) => ({ type: "group", id }) as const),
    ];
    return yield* statementsForPrincipals({
      organizationId: params.organizationId,
      principals,
    });
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

    const rawSessionId = session.session["id"];
    const sessionId = typeof rawSessionId === "string" ? rawSessionId : null;

    const member = yield* getActiveMember(headers);

    if (!member) {
      return yield* new Unauthorized({
        message: "Not a member of the active organization",
      });
    }

    // Owner = org root (unconditional allow); skip statement resolution entirely.
    // Otherwise resolve effective policy statements HERE, once per request, and
    // cache them into the context.
    const isOwner = roleIsOwner(member.role);
    const effectiveStatements = isOwner
      ? []
      : yield* resolveEffectiveStatements({
          organizationId: orgId,
          memberId: member.id,
        }).pipe(Effect.provide(REPO_LAYERS));

    return {
      userId: session.user.id,
      organizationId: orgId,
      memberId: member.id,
      role: member.role,
      isOwner,
      effectiveStatements,
      source: "session",
      transport,
      sessionId,
      actorEmail: session.user.email,
      isSuperadmin: authState.isSuperadmin,
    } as const satisfies AuthContextShape;
  });

// ── Bearer: API key (CI) or session token (CLI) ───────────────────

// Org-wide allow statements from an api-key's inline permission metadata
// (resource→actions). Additive on top of attachment-derived statements; an empty
// or absent map contributes nothing.
export const inlinePermissionStatements = (
  permissions: Record<string, readonly string[]> | null,
): readonly PolicyStatement[] =>
  permissions === null
    ? []
    : Object.entries(permissions).flatMap(([resource, actions]) =>
        actions.length === 0
          ? []
          : [
              {
                effect: "allow",
                actions: actions.map((act) => `${resource}:${act}`),
                resources: ["*"],
              },
            ],
      );

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

      const verifiedKey = result.key;
      const organizationId = verifiedKey.referenceId;

      return Effect.gen(function* () {
        // API-key permissions come from `policy_attachment` rows on the key
        // principal — resolved exactly like a member's (managed + real docs).
        // There is NO implicit admin baseline: a key with no attachments has no
        // permissions (spec §8 default-deny).
        const attachmentStatements = yield* statementsForPrincipals({
          organizationId,
          principals: [{ type: "apikey", id: verifiedKey.id }],
        }).pipe(Effect.provide(REPO_LAYERS));

        // Optional additive inline grants from better-auth key metadata (not used
        // by the dashboard/CLI, which create keys with no permissions map).
        const inlineStatements = inlinePermissionStatements(verifiedKey.permissions);

        return {
          userId: null,
          organizationId,
          memberId: null,
          role: null,
          isOwner: false,
          effectiveStatements: [...attachmentStatements, ...inlineStatements],
          source: "api-key",
          transport: "bearer",
          sessionId: null,
          actorEmail: "api-key",
          isSuperadmin: false,
        } as const satisfies AuthContextShape;
      });
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
