import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { NotFound } from "../errors";
import { ProjectRepo } from "../repositories/projects";
import { AuthContext } from "./context";
import { assertAccess, assertAccessAny } from "./policy";

import type { PolicyStatement } from "../authz-models";
import type { ProjectRepository } from "../repositories/projects";
import type { AuthContextShape } from "./context";

const baseActor: AuthContextShape = {
  userId: "u1",
  organizationId: "org-1",
  memberId: "m1",
  role: "member",
  isOwner: false,
  effectiveStatements: [],
  source: "session",
  transport: "cookie",
  sessionId: "sess-test",
  actorEmail: "dev@example.com",
  isSuperadmin: false,
};

const provide = (overrides: Partial<AuthContextShape>) =>
  Effect.provideService(AuthContext, { ...baseActor, ...overrides });

const allow = (actions: string[], resources: string[]): PolicyStatement => ({
  effect: "allow",
  actions,
  resources,
});
const deny = (actions: string[], resources: string[]): PolicyStatement => ({
  effect: "deny",
  actions,
  resources,
});

const isForbidden = (effect: Effect.Effect<void, unknown>) =>
  Effect.gen(function* () {
    const exit = yield* effect.pipe(Effect.exit);
    return Exit.isFailure(exit);
  });

describe(assertAccess, () => {
  it.effect("owner bypasses (allow-all, even with no statements)", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess("billing", "delete").pipe(provide({ isOwner: true })),
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

  it.effect("default-deny when no statement matches", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess("channel", "create", { kind: "project", projectId: "A" }).pipe(provide({})),
      );
      expect(forbidden).toBe(true);
    }),
  );

  it.effect("allow via a project-scoped statement", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess("channel", "create", { kind: "project", projectId: "A" }).pipe(
          provide({ effectiveStatements: [allow(["channel:*"], ["project/A"])] }),
        ),
      );
      expect(forbidden).toBe(false);
    }),
  );

  it.effect("scoped statement does not grant a different project", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess("channel", "create", { kind: "project", projectId: "B" }).pipe(
          provide({ effectiveStatements: [allow(["channel:*"], ["project/A"])] }),
        ),
      );
      expect(forbidden).toBe(true);
    }),
  );

  it.effect("deny wins over allow (non-owner)", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess("update", "create", {
          kind: "update",
          projectId: "A",
          channelId: "X",
        }).pipe(
          provide({
            effectiveStatements: [
              allow(["update:*"], ["*"]),
              deny(["update:create"], ["project/A"]),
            ],
          }),
        ),
      );
      expect(forbidden).toBe(true);
    }),
  );

  it.effect("owner is NOT subject to deny", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess("update", "create", {
          kind: "update",
          projectId: "A",
          channelId: "X",
        }).pipe(provide({ isOwner: true, effectiveStatements: [deny(["update:create"], ["*"])] })),
      );
      expect(forbidden).toBe(false);
    }),
  );
});

describe(assertAccessAny, () => {
  it.effect("owner / superadmin bypass", () =>
    Effect.gen(function* () {
      expect(
        yield* isForbidden(assertAccessAny("update", "create").pipe(provide({ isOwner: true }))),
      ).toBe(false);
      expect(
        yield* isForbidden(
          assertAccessAny("update", "create").pipe(provide({ isSuperadmin: true })),
        ),
      ).toBe(false);
    }),
  );

  it.effect("passes when update:create is held on ANY scope (narrow publisher)", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccessAny("update", "create").pipe(
          provide({ effectiveStatements: [allow(["update:create"], ["project/A/channel/X"])] }),
        ),
      );
      expect(forbidden).toBe(false);
    }),
  );

  it.effect("denies a principal that holds no update:create anywhere (viewer)", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccessAny("update", "create").pipe(
          provide({ effectiveStatements: [allow(["update:read"], ["*"])] }),
        ),
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
        assertAccess("channel", "create", { kind: "project", projectId: "A" }).pipe(
          provideArchived(ARCHIVED_AT, { isOwner: true }),
        ),
      );
      expect(forbidden).toBe(true);
    }),
  );

  it.effect("blocks a deep channel-axis write (publish) when archived", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess("update", "create", { kind: "update", projectId: "A", channelId: "X" }).pipe(
          provideArchived(ARCHIVED_AT, { isOwner: true }),
        ),
      );
      expect(forbidden).toBe(true);
    }),
  );

  it.effect("allows the same write when the project is active", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess("channel", "create", { kind: "project", projectId: "A" }).pipe(
          provideArchived(null, { isOwner: true }),
        ),
      );
      expect(forbidden).toBe(false);
    }),
  );

  it.effect("does NOT block reads on an archived project", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess("project", "read", { kind: "project", projectId: "A" }).pipe(
          provideArchived(ARCHIVED_AT, { isOwner: true }),
        ),
      );
      expect(forbidden).toBe(false);
    }),
  );

  it.effect("does NOT block deleting the archived project itself", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess("project", "delete", { kind: "project", projectId: "A" }).pipe(
          provideArchived(ARCHIVED_AT, { isOwner: true }),
        ),
      );
      expect(forbidden).toBe(false);
    }),
  );

  it.effect("blocks deleting a sub-resource (channel) on an archived project", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess("channel", "delete", { kind: "channel", projectId: "A", channelId: "X" }).pipe(
          provideArchived(ARCHIVED_AT, { isOwner: true }),
        ),
      );
      expect(forbidden).toBe(true);
    }),
  );

  it.effect("allowArchived bypasses the guard (the unarchive path)", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess(
          "project",
          "update",
          { kind: "project", projectId: "A" },
          { allowArchived: true },
        ).pipe(provideArchived(ARCHIVED_AT, { isOwner: true })),
      );
      expect(forbidden).toBe(false);
    }),
  );
});
