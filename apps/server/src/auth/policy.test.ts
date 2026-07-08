import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { NotFound } from "../errors";
import { ProjectRepo } from "../repositories/projects";
import { ProtectedEnvironmentRepo } from "../repositories/protected-environments";
import { AuthContext } from "./context";
import {
  assertAccess,
  assertAccessAny,
  assertSuperadmin,
  assertVaultParticipant,
  matrixAllows,
} from "./policy";

import type { ProjectRepository } from "../repositories/projects";
import type { ProtectedEnvironmentRepository } from "../repositories/protected-environments";
import type { AuthContextShape } from "./context";

const baseActor: AuthContextShape = {
  userId: "u1",
  organizationId: "org-1",
  memberId: "m1",
  role: "member",
  orgRole: "member",
  isOwner: false,
  projectRoles: {},
  source: "session",
  transport: "cookie",
  sessionId: "sess-test",
  actorEmail: "dev@example.com",
  isSuperadmin: false,
  robotId: null,
};

const provide = (overrides: Partial<AuthContextShape>) =>
  Effect.provideService(AuthContext, { ...baseActor, ...overrides });

const isForbidden = (effect: Effect.Effect<void, unknown>) =>
  Effect.gen(function* () {
    const exit = yield* effect.pipe(Effect.exit);
    return Exit.isFailure(exit);
  });

describe(assertAccess, () => {
  it.effect("owner bypasses (allow-all)", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess("billing", "delete").pipe(provide({ isOwner: true, orgRole: "owner" })),
      );
      expect(forbidden).toBe(false);
    }),
  );

  it.effect("superadmin bypasses", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess("organization", "delete").pipe(provide({ isSuperadmin: true })),
      );
      expect(forbidden).toBe(false);
    }),
  );

  it.effect("default-deny: a plain member with no rows cannot write a project", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess("channel", "create", {
          kind: "channel",
          projectId: "projA",
          environment: "feature-x",
          channelId: "ch1",
        }).pipe(provide({})),
      );
      expect(forbidden).toBe(true);
    }),
  );

  it.effect("developer on the target project can publish; reporter cannot", () =>
    Effect.gen(function* () {
      const target = {
        kind: "update",
        projectId: "projA",
        environment: "feature-x",
        channelId: "ch1",
      } as const;
      const asDeveloper = yield* isForbidden(
        assertAccess("update", "create", target).pipe(
          provide({ projectRoles: { projA: "developer" } }),
        ),
      );
      const asReporter = yield* isForbidden(
        assertAccess("update", "create", target).pipe(
          provide({ projectRoles: { projA: "reporter" } }),
        ),
      );
      expect(asDeveloper).toBe(false);
      expect(asReporter).toBe(true);
    }),
  );

  it.effect("a role on project A grants nothing on project B", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess("project", "read", { kind: "project", projectId: "projB" }).pipe(
          provide({ projectRoles: { projA: "maintainer" } }),
        ),
      );
      expect(forbidden).toBe(true);
    }),
  );

  it.effect("org admin is an implicit maintainer on every project", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess("project", "update", { kind: "project", projectId: "projB" }).pipe(
          provide({ orgRole: "admin" }),
        ),
      );
      expect(forbidden).toBe(false);
    }),
  );

  it.effect("project:delete falls back to the org rule even with a project target", () =>
    Effect.gen(function* () {
      const asMaintainer = yield* isForbidden(
        assertAccess("project", "delete", { kind: "project", projectId: "projA" }).pipe(
          provide({ projectRoles: { projA: "maintainer" } }),
        ),
      );
      const asAdmin = yield* isForbidden(
        assertAccess("project", "delete", { kind: "project", projectId: "projA" }).pipe(
          provide({ orgRole: "admin" }),
        ),
      );
      expect(asMaintainer).toBe(true);
      expect(asAdmin).toBe(false);
    }),
  );

  it.effect("org-global env vars: developer-anywhere reads, only admin writes", () =>
    Effect.gen(function* () {
      const globalVar = { kind: "envVar", projectId: "global", environment: "production" } as const;
      const developer = { projectRoles: { projA: "developer" } } as const;
      const readAsDeveloper = yield* isForbidden(
        assertAccess("envVar", "read", globalVar).pipe(provide(developer)),
      );
      const writeAsDeveloper = yield* isForbidden(
        assertAccess("envVar", "update", globalVar).pipe(provide(developer)),
      );
      const writeAsAdmin = yield* isForbidden(
        assertAccess("envVar", "update", globalVar).pipe(provide({ orgRole: "admin" })),
      );
      expect(readAsDeveloper).toBe(false);
      expect(writeAsDeveloper).toBe(true);
      expect(writeAsAdmin).toBe(false);
    }),
  );

  it.effect("credential/device tokens are NOT decided by the generic gate (v2 §1a)", () =>
    Effect.gen(function* () {
      // Their gate needs the binding set and lives in the credential access
      // helpers — the org-target matrix path denies even an org admin, so a
      // handler that forgot to switch to the helpers fails closed.
      const asDeveloper = yield* isForbidden(
        assertAccess("device", "create").pipe(provide({ projectRoles: { projA: "developer" } })),
      );
      const asAdmin = yield* isForbidden(
        assertAccess("device", "create").pipe(provide({ orgRole: "admin" })),
      );
      expect(asDeveloper).toBe(true);
      expect(asAdmin).toBe(true);
    }),
  );

  it.effect("owner-tier org rules stay above admin (billing)", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess("billing", "read").pipe(provide({ orgRole: "admin" })),
      );
      expect(forbidden).toBe(true);
    }),
  );
});

// A ProjectRepo whose only meaningful method is `findArchivedAt` — the archived
// read-only guard's single dependency. Other methods fail loudly so a test that
// trips them is obviously wrong.
const archivedRepo = (archivedAt: string | null): ProjectRepository => ({
  insert: () => Effect.void,
  findByOrg: () => Effect.succeed({ items: [], total: 0 }),
  findById: () => Effect.fail(new NotFound({ message: "unexpected" })),
  findBySlug: () => Effect.fail(new NotFound({ message: "unexpected" })),
  findByIds: () => Effect.succeed(new Map()),
  listAllIds: () => Effect.succeed([]),
  findOrgIdById: () => Effect.fail(new NotFound({ message: "unexpected" })),
  updateName: () => Effect.void,
  updateLogoUrl: () => Effect.void,
  delete: () => Effect.void,
  findArchivedAt: () => Effect.succeed(archivedAt),
  setArchived: () => Effect.void,
  bumpLastActivity: () => Effect.void,
  bumpLastActivityByBranch: () => Effect.void,
});

// Provide the actor AND a ProjectRepo so `serviceOption(ProjectRepo)` resolves
// `Some` and the archived guard actually runs (it no-ops without a repo).
const provideArchived =
  (archivedAt: string | null, overrides: Partial<AuthContextShape> = {}) =>
  <Success, Failure>(
    effect: Effect.Effect<Success, Failure, AuthContext | ProjectRepo>,
  ): Effect.Effect<Success, Failure> =>
    effect.pipe(
      Effect.provideService(AuthContext, { ...baseActor, ...overrides }),
      Effect.provideService(ProjectRepo, archivedRepo(archivedAt)),
    );

const ARCHIVED_AT = "2026-06-23T00:00:00.000Z";

describe("archived read-only guard", () => {
  it.effect("blocks a project-scoped write when archived — even for an owner", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess("channel", "create", {
          kind: "channel",
          projectId: "projA",
          environment: "development",
          channelId: "ch1",
        }).pipe(provideArchived(ARCHIVED_AT, { isOwner: true, orgRole: "owner" })),
      );
      expect(forbidden).toBe(true);
    }),
  );

  it.effect("reads and the project's own delete stay allowed while archived", () =>
    Effect.gen(function* () {
      const read = yield* isForbidden(
        assertAccess("project", "read", { kind: "project", projectId: "projA" }).pipe(
          provideArchived(ARCHIVED_AT, { projectRoles: { projA: "reporter" } }),
        ),
      );
      const remove = yield* isForbidden(
        assertAccess("project", "delete", { kind: "project", projectId: "projA" }).pipe(
          provideArchived(ARCHIVED_AT, { orgRole: "admin" }),
        ),
      );
      expect(read).toBe(false);
      expect(remove).toBe(false);
    }),
  );

  it.effect("allowArchived opts the archive endpoints out of the guard", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess(
          "project",
          "update",
          { kind: "project", projectId: "projA" },
          { allowArchived: true },
        ).pipe(provideArchived(ARCHIVED_AT, { projectRoles: { projA: "maintainer" } })),
      );
      expect(forbidden).toBe(false);
    }),
  );
});

// A ProtectedEnvironmentRepo stub — the protected-env guard's single
// dependency (it no-ops without a repo, mirroring the archived guard).
const protectedEnvRepo = (names: readonly string[]): ProtectedEnvironmentRepository => ({
  listByOrg: () => Effect.succeed(new Set(names)),
  protect: () => Effect.void,
  unprotect: () => Effect.void,
});

const provideProtected =
  (names: readonly string[], overrides: Partial<AuthContextShape> = {}) =>
  <Success, Failure>(
    effect: Effect.Effect<Success, Failure, AuthContext | ProtectedEnvironmentRepo>,
  ): Effect.Effect<Success, Failure> =>
    effect.pipe(
      Effect.provideService(AuthContext, { ...baseActor, ...overrides }),
      Effect.provideService(ProtectedEnvironmentRepo, protectedEnvRepo(names)),
    );

describe("protected-environment guard (GITLAB-RBAC-SPEC §3a)", () => {
  const productionUpdate = {
    kind: "update",
    projectId: "projA",
    environment: "production",
    channelId: "ch1",
  } as const;

  it.effect("a developer cannot write into a protected environment", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess("update", "create", productionUpdate).pipe(
          provideProtected(["production"], { projectRoles: { projA: "developer" } }),
        ),
      );
      expect(forbidden).toBe(true);
    }),
  );

  it.effect("a maintainer (and an org admin) can", () =>
    Effect.gen(function* () {
      const asMaintainer = yield* isForbidden(
        assertAccess("update", "create", productionUpdate).pipe(
          provideProtected(["production"], { projectRoles: { projA: "maintainer" } }),
        ),
      );
      const asAdmin = yield* isForbidden(
        assertAccess("update", "create", productionUpdate).pipe(
          provideProtected(["production"], { orgRole: "admin" }),
        ),
      );
      expect(asMaintainer).toBe(false);
      expect(asAdmin).toBe(false);
    }),
  );

  it.effect("non-protected environments keep the base developer allow", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess("update", "create", productionUpdate).pipe(
          provideProtected(["staging"], { projectRoles: { projA: "developer" } }),
        ),
      );
      expect(forbidden).toBe(false);
    }),
  );

  it.effect("reads into a protected environment stay open to reporters", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess("update", "read", productionUpdate).pipe(
          provideProtected(["production"], { projectRoles: { projA: "reporter" } }),
        ),
      );
      expect(forbidden).toBe(false);
    }),
  );
});

describe(assertAccessAny, () => {
  it.effect("passes when the anywhere-rank meets the token's rule", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccessAny("appleCredential", "read").pipe(
          provide({ projectRoles: { projA: "developer" } }),
        ),
      );
      expect(forbidden).toBe(false);
    }),
  );

  it.effect("falls back to org rules (invitation:create for an admin)", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccessAny("invitation", "create").pipe(provide({ orgRole: "admin" })),
      );
      expect(forbidden).toBe(false);
    }),
  );

  it.effect("denies a principal with no qualifying rank (default-deny)", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccessAny("appleCredential", "read").pipe(provide({})),
      );
      expect(forbidden).toBe(true);
    }),
  );
});

describe(matrixAllows, () => {
  it("apple-team targets are default-deny here — the binding helpers decide (v2 §1a)", () => {
    expect(
      matrixAllows(
        { orgRole: "member", projectRoles: { projA: "developer" } },
        "appleCredential",
        "read",
        {
          kind: "appleCredential",
          appleTeamId: "JMANGO1234",
        },
      ),
    ).toBe(false);
    expect(
      matrixAllows({ orgRole: "admin", projectRoles: {} }, "appleCredential", "read", {
        kind: "appleCredential",
        appleTeamId: "JMANGO1234",
      }),
    ).toBe(false);
  });

  it("unknown tokens are denied everywhere below owner", () => {
    expect(
      matrixAllows({ orgRole: "admin", projectRoles: {} }, "organization", "delete", {
        kind: "org",
      }),
    ).toBe(false);
  });
});

describe("vault participation gate", () => {
  it.effect("passes owner/superadmin/org admin", () =>
    Effect.gen(function* () {
      const asOwner = yield* isForbidden(
        assertVaultParticipant.pipe(provide({ isOwner: true, orgRole: "owner" })),
      );
      const asSuperadmin = yield* isForbidden(
        assertVaultParticipant.pipe(provide({ isSuperadmin: true })),
      );
      const asAdmin = yield* isForbidden(
        assertVaultParticipant.pipe(provide({ orgRole: "admin" })),
      );
      expect(asOwner).toBe(false);
      expect(asSuperadmin).toBe(false);
      expect(asAdmin).toBe(false);
    }),
  );

  it.effect("passes a member (or robot) with ≥ developer on some project", () =>
    Effect.gen(function* () {
      const asDeveloper = yield* isForbidden(
        assertVaultParticipant.pipe(provide({ projectRoles: { p1: "developer" } })),
      );
      const asRobotMaintainer = yield* isForbidden(
        assertVaultParticipant.pipe(
          provide({
            userId: null,
            memberId: null,
            source: "robot",
            transport: "bearer",
            robotId: "rob-1",
            projectRoles: { p1: "maintainer" },
          }),
        ),
      );
      expect(asDeveloper).toBe(false);
      expect(asRobotMaintainer).toBe(false);
    }),
  );

  it.effect("denies reporter-only and project-less members", () =>
    Effect.gen(function* () {
      const asReporter = yield* isForbidden(
        assertVaultParticipant.pipe(provide({ projectRoles: { p1: "reporter" } })),
      );
      const asBareMember = yield* isForbidden(assertVaultParticipant.pipe(provide({})));
      expect(asReporter).toBe(true);
      expect(asBareMember).toBe(true);
    }),
  );
});

describe("superadmin gate", () => {
  it.effect("requires the platform flag, not org role", () =>
    Effect.gen(function* () {
      const asOwner = yield* isForbidden(
        assertSuperadmin.pipe(provide({ isOwner: true, orgRole: "owner" })),
      );
      const asSuperadmin = yield* isForbidden(
        assertSuperadmin.pipe(provide({ isSuperadmin: true })),
      );
      expect(asOwner).toBe(true);
      expect(asSuperadmin).toBe(false);
    }),
  );
});
