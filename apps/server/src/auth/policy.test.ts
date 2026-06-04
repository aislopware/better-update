import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { AuthContext } from "./context";
import { assertAccess, assertAccessAny } from "./policy";

import type { PolicyStatement } from "../authz-models";
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
