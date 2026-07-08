import { Authentication } from "@better-update/api";
import { isRecord } from "@better-update/type-guards";
import { HttpServerRequest } from "@effect/platform";
import { Effect, Layer, Redacted } from "effect";

import { createAuth } from "../auth";
import { cloudflareEnv } from "../cloudflare/context";
import { CryptoServiceLive } from "../cloudflare/crypto-service";
import { Forbidden, Unauthorized } from "../errors";
import { ProjectMemberRepo, ProjectMemberRepoLive } from "../repositories/project-members";
import { RobotAccountRepo, RobotAccountRepoLive } from "../repositories/robot-accounts";
import { ROBOT_BEARER_PREFIX } from "./constants";
import { roleIsOwner } from "./owner";
import { roleIsSuperadmin } from "./superadmin";

import type { OrgRole, ProjectRole } from "../models";
import type { AuthContextShape } from "./context";

// RobotAccountRepoLive needs CryptoService to construct itself, which merging
// alone doesn't wire up — Layer.provide feeds CryptoServiceLive's output in.
const ROBOT_LAYERS = RobotAccountRepoLive.pipe(Layer.provide(CryptoServiceLive));

// ── Plugin API facade (types not inferred from betterAuth config) ──

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
    typeof api["getSession"] !== "function" ||
    typeof api["getActiveMember"] !== "function"
  ) {
    // eslint-disable-next-line functional/no-throw-statements -- bootstrap invariant; plugin misconfiguration is unrecoverable
    throw new Error(
      "Better Auth api is missing expected plugin methods (getSession / getActiveMember)",
    );
  }
  // eslint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- runtime shape validated above; BetterAuthApi narrows Better Auth's opaque plugin object
  return api as unknown as BetterAuthApi;
};

const authApi = Effect.gen(function* () {
  const env = yield* cloudflareEnv;
  return assertBetterAuthApi(createAuth(env).api);
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
export const getUserAuthState = (userId: string) =>
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

// The org ladder position (GITLAB-RBAC-SPEC §1) from the raw better-auth
// `member.role` string. Only these three values mean anything; any legacy
// spelling degrades to plain "member" (fail closed).
export const toOrgRole = (role: string | null | undefined): OrgRole => {
  if (typeof role === "string" && roleIsOwner(role)) {
    return "owner";
  }
  return role === "admin" ? "admin" : "member";
};

// Resolve the member's project_member rows ONCE per request. Owner/admin
// skip the query entirely — they are implicit maintainers everywhere
// (role-matrix.ts), so their rows (if any) are irrelevant. Robots never go
// through here: their single project role rides the robot_account row.
export const resolveProjectRoles = (params: {
  readonly organizationId: string;
  readonly orgRole: OrgRole;
  readonly memberId: string;
}): Effect.Effect<Readonly<Record<string, ProjectRole>>, never, ProjectMemberRepo> =>
  params.orgRole === "member"
    ? ProjectMemberRepo.pipe(
        Effect.flatMap((repo) =>
          repo.rolesForPrincipal({
            organizationId: params.organizationId,
            principalType: "member",
            principalId: params.memberId,
          }),
        ),
      )
    : Effect.succeed({});

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

    const orgRole = toOrgRole(member.role);
    const projectRoles = yield* resolveProjectRoles({
      organizationId: orgId,
      orgRole,
      memberId: member.id,
    }).pipe(Effect.provide(ProjectMemberRepoLive));

    return {
      userId: session.user.id,
      organizationId: orgId,
      memberId: member.id,
      role: member.role,
      orgRole,
      isOwner: orgRole === "owner",
      projectRoles,
      source: "session",
      transport,
      sessionId,
      actorEmail: session.user.email,
      isSuperadmin: authState.isSuperadmin,
      robotId: null,
    } as const satisfies AuthContextShape;
  });

// ── Bearer: robot account (CI) or session token (CLI) ──────────────

// One Authorization-bearer handler for both machine credentials. Tokens with
// the robot bearer prefix resolve to an org-scoped, user-less actor; anything
// else is treated as a Better Auth session token (the CLI's login token) and
// resolved as a real user session via the `bearer()` plugin. An empty token
// fails so Effect's security middleware falls through to the cookie scheme
// (the browser dashboard).
const resolveFromBearer = (token: Redacted.Redacted) => {
  const key = Redacted.value(token);
  if (key.length === 0) {
    return Effect.fail(new Unauthorized({ message: "Missing bearer token" }));
  }

  if (!key.startsWith(ROBOT_BEARER_PREFIX)) {
    return resolveSession("bearer");
  }

  return Effect.gen(function* () {
    const robotAccountRepo = yield* RobotAccountRepo;
    const verified = yield* robotAccountRepo.verifyBearer({ plaintext: key });
    if (verified === null) {
      return yield* new Unauthorized({ message: "Invalid robot bearer secret" });
    }

    // A robot is PROJECT-scoped (GITLAB-RBAC-SPEC §1b, v2): its whole grant
    // is the single (projectId → role) entry carried on the robot row.
    // Org-level: plain member — a robot can do exactly what a human with
    // that one membership row could, plus nothing org-administrative.
    // verifyBearer resolves the single (projectId → role) grant.
    return {
      userId: null,
      organizationId: verified.organizationId,
      memberId: null,
      role: null,
      orgRole: "member",
      isOwner: false,
      projectRoles: { [verified.projectId]: verified.role },
      source: "robot",
      transport: "bearer",
      sessionId: null,
      // Attribution: the audit trail must distinguish WHICH robot acted, so the
      // actor label carries the robot's name and `robotId` its stable id.
      actorEmail: `robot:${verified.name}`,
      isSuperadmin: false,
      robotId: verified.id,
    } as const satisfies AuthContextShape;
  }).pipe(Effect.provide(ROBOT_LAYERS));
};

// ── Cookie (browser session) ──────────────────────────────────────

const resolveFromSession = (_cookie: Redacted.Redacted) => resolveSession("cookie");

// ── Layer ──────────────────────────────────────────────────────────

export const AuthenticationLive = Layer.succeed(Authentication, {
  bearer: resolveFromBearer,
  cookie: resolveFromSession,
});
