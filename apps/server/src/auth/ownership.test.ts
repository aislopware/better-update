import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { NotFound } from "../errors";
import { ProjectRepo } from "../repositories/projects";
import { AuthContext } from "./context";
import { assertOrgOwnership, assertProjectOwnership } from "./ownership";
import { permissions } from "./permissions";

const provideAuth = (organizationId: string) =>
  Effect.provideService(AuthContext, {
    userId: "test-user",
    organizationId,
    role: "owner",
    effectivePermissions: permissions.owner,
    source: "session",
    transport: "cookie",
    actorEmail: "test@example.com",
  });

describe(assertOrgOwnership, () => {
  it.effect("succeeds when org IDs match", () =>
    assertOrgOwnership("org-1").pipe(provideAuth("org-1")),
  );

  it.effect("fails with NotFound when org IDs differ", () =>
    Effect.gen(function* () {
      expect.assertions(2);
      const exit = yield* assertOrgOwnership("org-other").pipe(provideAuth("org-1"), Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = exit.cause.pipe((cause) => (cause._tag === "Fail" ? cause.error : undefined));
        expect(error).toMatchObject({ _tag: "NotFound", message: "Resource not found" });
      }
    }),
  );

  it.effect("returns 'Resource not found' to prevent enumeration", () =>
    Effect.gen(function* () {
      expect.assertions(1);
      const exit = yield* assertOrgOwnership("org-other").pipe(provideAuth("org-1"), Effect.exit);
      if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
        expect(exit.cause.error.message).toBe("Resource not found");
      }
    }),
  );
});

const mockProjectRepo = (orgId: string | null) =>
  Effect.provideService(ProjectRepo, {
    insert: () => Effect.void,
    findByOrg: () => Effect.succeed({ items: [], total: 0 }),
    findById: () => Effect.fail(new NotFound({ message: "Not found" })),
    findBySlug: () => Effect.fail(new NotFound({ message: "Not found" })),
    findByIds: () => Effect.succeed(new Map()),
    findOrgIdById: () =>
      orgId === null
        ? Effect.fail(new NotFound({ message: "Project not found" }))
        : Effect.succeed(orgId),
    updateName: () => Effect.void,
    delete: () => Effect.void,
    bumpLastActivity: () => Effect.void,
    bumpLastActivityByBranch: () => Effect.void,
  });

describe(assertProjectOwnership, () => {
  it.effect("succeeds when project exists and belongs to caller's org", () =>
    assertProjectOwnership("project-1").pipe(mockProjectRepo("org-1"), provideAuth("org-1")),
  );

  it.effect("fails with NotFound when project doesn't exist", () =>
    Effect.gen(function* () {
      expect.assertions(2);
      const exit = yield* assertProjectOwnership("missing").pipe(
        mockProjectRepo(null),
        provideAuth("org-1"),
        Effect.exit,
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
        expect(exit.cause.error).toMatchObject({ _tag: "NotFound" });
      }
    }),
  );

  it.effect("fails with NotFound when project belongs to different org", () =>
    Effect.gen(function* () {
      expect.assertions(2);
      const exit = yield* assertProjectOwnership("project-1").pipe(
        mockProjectRepo("org-other"),
        provideAuth("org-1"),
        Effect.exit,
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
        expect(exit.cause.error).toMatchObject({
          _tag: "NotFound",
          message: "Resource not found",
        });
      }
    }),
  );
});
