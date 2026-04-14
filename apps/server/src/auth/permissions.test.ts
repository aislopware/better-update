import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { AuthContext } from "./context";
import { assertPermission, permissions } from "./permissions";

import type { Action, EffectivePermissions, Role } from "./context";

const provideAuth = (role: Role, overrides?: Partial<EffectivePermissions>) =>
  Effect.provideService(AuthContext, {
    userId: "test-user",
    organizationId: "test-org",
    role,
    effectivePermissions: { ...permissions[role], ...overrides },
    source: "session",
    actorEmail: "test@example.com",
  });

describe("permissions map", () => {
  test("owner has all resources", () => {
    const ownerResources = Object.keys(permissions.owner);
    expect(ownerResources).toContain("organization");
    expect(ownerResources).toContain("billing");
    expect(ownerResources).toContain("apiKey");
    expect(ownerResources).toContain("project");
  });

  test("viewer has only read actions", () => {
    for (const actions of Object.values(permissions.viewer)) {
      expect(actions).toEqual(["read"]);
    }
  });

  test("developer cannot access billing", () => {
    expect(permissions.developer.billing).toBeUndefined();
  });

  test("developer cannot manage organization", () => {
    expect(permissions.developer.organization).toBeUndefined();
  });
});

describe(assertPermission, () => {
  it.effect("succeeds when role has permission", () =>
    assertPermission("project", "read").pipe(provideAuth("owner")),
  );

  it.effect("succeeds for developer reading projects", () =>
    assertPermission("project", "read").pipe(provideAuth("developer")),
  );

  it.effect("fails with Forbidden when permission missing", () =>
    Effect.gen(function* () {
      const exit = yield* assertPermission("billing", "update").pipe(
        provideAuth("viewer"),
        Effect.exit,
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = exit.cause.pipe((cause) => (cause._tag === "Fail" ? cause.error : undefined));
        expect(error).toMatchObject({
          _tag: "Forbidden",
          message: "Insufficient permission: billing:update",
        });
      }
    }),
  );

  it.effect("fails for viewer trying to create", () =>
    Effect.gen(function* () {
      const exit = yield* assertPermission("project", "create").pipe(
        provideAuth("viewer"),
        Effect.exit,
      );
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  it.effect("fails for developer accessing billing", () =>
    Effect.gen(function* () {
      const exit = yield* assertPermission("billing", "read").pipe(
        provideAuth("developer"),
        Effect.exit,
      );
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  test.each<[Role, string, Action]>([
    ["owner", "project", "delete"],
    ["admin", "member", "create"],
    ["developer", "channel", "update"],
    ["viewer", "project", "read"],
  ])("%s can %s %s", (role, resource, action) => {
    const actions = permissions[role][resource as keyof typeof permissions.owner];
    expect(actions).toContain(action);
  });
});
