import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { AuthContext } from "./context";
import { assertPermission, assertSuperadmin, permissions } from "./permissions";

import type { BuiltinRole } from "../models";
import type { Action, EffectivePermissions } from "./context";

const provideAuth = (
  role: BuiltinRole,
  overrides?: Partial<EffectivePermissions>,
  isSuperadmin = false,
) =>
  Effect.provideService(AuthContext, {
    userId: "test-user",
    organizationId: "test-org",
    memberId: "test-member",
    role,
    effectivePermissions: { ...permissions[role], ...overrides },
    source: "session",
    transport: "cookie",
    actorEmail: "test@example.com",
    isSuperadmin,
  });

describe("permissions map", () => {
  it("owner has all resources", () => {
    const ownerResources = Object.keys(permissions.owner);
    expect(ownerResources).toContain("organization");
    expect(ownerResources).toContain("billing");
    expect(ownerResources).toContain("apiKey");
    expect(ownerResources).toContain("project");
  });

  it("viewer has only read actions", () => {
    for (const actions of Object.values(permissions.viewer)) {
      expect(actions).toStrictEqual(["read"]);
    }
  });

  it("developer cannot access billing", () => {
    expect(permissions.developer.billing).toBeUndefined();
  });

  it("developer cannot manage organization", () => {
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

  it.effect("allows a viewer to read env vars", () =>
    assertPermission("envVar", "read").pipe(provideAuth("viewer")),
  );

  it.effect("denies a viewer from mutating env vars", () =>
    Effect.gen(function* () {
      for (const action of ["create", "update", "delete"] as const) {
        const exit = yield* assertPermission("envVar", action).pipe(
          provideAuth("viewer"),
          Effect.exit,
        );
        expect(Exit.isFailure(exit)).toBe(true);
      }
    }),
  );

  it.effect("allows a developer to create and update but not delete env vars", () =>
    Effect.gen(function* () {
      yield* assertPermission("envVar", "create").pipe(provideAuth("developer"));
      yield* assertPermission("envVar", "update").pipe(provideAuth("developer"));

      const exit = yield* assertPermission("envVar", "delete").pipe(
        provideAuth("developer"),
        Effect.exit,
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = exit.cause.pipe((cause) => (cause._tag === "Fail" ? cause.error : undefined));
        expect(error).toMatchObject({
          _tag: "Forbidden",
          message: "Insufficient permission: envVar:delete",
        });
      }
    }),
  );

  it.each<[BuiltinRole, string, Action]>([
    ["owner", "project", "delete"],
    ["admin", "member", "create"],
    ["developer", "channel", "update"],
    ["viewer", "project", "read"],
  ])("%s can %s %s", (role, resource, action) => {
    const actions = permissions[role][resource as keyof typeof permissions.owner];
    expect(actions).toContain(action);
  });

  // L1: the `ac` meta-resource (manage custom roles) is owner/admin only.
  it.effect.each<BuiltinRole>(["owner", "admin"])(
    "%s can create custom roles (ac:create)",
    (role) => assertPermission("ac", "create").pipe(provideAuth(role)),
  );

  it.effect.each<BuiltinRole>(["developer", "viewer"])(
    "%s cannot create custom roles (ac:create -> Forbidden)",
    (role) =>
      Effect.gen(function* () {
        const exit = yield* assertPermission("ac", "create").pipe(provideAuth(role), Effect.exit);
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
          expect(exit.cause.error).toMatchObject({
            _tag: "Forbidden",
            message: "Insufficient permission: ac:create",
          });
        }
      }),
  );

  it.effect("viewer cannot read custom roles (ac:read -> Forbidden)", () =>
    Effect.gen(function* () {
      const exit = yield* assertPermission("ac", "read").pipe(provideAuth("viewer"), Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );
});

describe("assertSuperadmin guard", () => {
  it.effect("succeeds for a superadmin", () =>
    assertSuperadmin.pipe(provideAuth("owner", undefined, true)),
  );

  it.effect("fails with Forbidden for a non-superadmin", () =>
    Effect.gen(function* () {
      const exit = yield* assertSuperadmin.pipe(
        provideAuth("owner", undefined, false),
        Effect.exit,
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = exit.cause.pipe((cause) => (cause._tag === "Fail" ? cause.error : undefined));
        expect(error).toMatchObject({ _tag: "Forbidden", message: "Superadmin access required" });
      }
    }),
  );
});
