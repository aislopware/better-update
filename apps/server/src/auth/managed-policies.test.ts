import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { AuthContext } from "./context";
import {
  isManagedPolicyId,
  MANAGED_POLICIES,
  MANAGED_POLICY_LIST,
  resolveManagedDocument,
} from "./managed-policies";
import { assertAccess } from "./policy";

import type { AuthContextShape } from "./context";

describe(isManagedPolicyId, () => {
  it("is true for the three real preset ids", () => {
    expect(isManagedPolicyId("managed:admin")).toBe(true);
    expect(isManagedPolicyId("managed:developer")).toBe(true);
    expect(isManagedPolicyId("managed:viewer")).toBe(true);
  });

  it("is false for owner (root bypass, not a policy) and unknown/malformed ids", () => {
    for (const id of ["managed:owner", "managed:bogus", "managed:", "admin", "managed", ""]) {
      expect(isManagedPolicyId(id)).toBe(false);
    }
  });
});

describe(resolveManagedDocument, () => {
  it("returns a read-only org-wide document for managed:viewer", () => {
    const document = resolveManagedDocument("managed:viewer");
    expect(document).not.toBeNull();
    expect(document?.statements.every((stmt) => stmt.effect === "allow")).toBe(true);
    expect(
      document?.statements.every(
        (stmt) => stmt.resources.length === 1 && stmt.resources[0] === "*",
      ),
    ).toBe(true);
    const tokens = document?.statements.flatMap((stmt) => stmt.actions) ?? [];
    expect(tokens.every((token) => token.endsWith(":read"))).toBe(true);
  });

  it("returns null for owner and non-managed ids", () => {
    expect(resolveManagedDocument("managed:owner")).toBeNull();
    expect(resolveManagedDocument("00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});

describe("MANAGED_POLICY_LIST contents", () => {
  it("is exactly the three presets, all org '*'", () => {
    expect(MANAGED_POLICY_LIST.map((policy) => policy.id).toSorted()).toStrictEqual([
      "managed:admin",
      "managed:developer",
      "managed:viewer",
    ]);
    expect(MANAGED_POLICY_LIST.every((policy) => policy.organizationId === "*")).toBe(true);
  });

  it("admin grants create tokens that viewer does not", () => {
    const adminTokens = MANAGED_POLICIES["managed:admin"].document.statements.flatMap(
      (stmt) => stmt.actions,
    );
    const viewerTokens = MANAGED_POLICIES["managed:viewer"].document.statements.flatMap(
      (stmt) => stmt.actions,
    );
    expect(adminTokens).toContain("policy:create");
    expect(adminTokens).toContain("channel:create");
    expect(viewerTokens).not.toContain("channel:create");
  });

  it("grants the viewer NO vault access (not a vault participant)", () => {
    const viewerTokens = MANAGED_POLICIES["managed:viewer"].document.statements.flatMap(
      (stmt) => stmt.actions,
    );
    // A viewer must hold no `vaultAccess:*` token at all — `vaultAccess:read`
    // alone is the foothold for the device-enrol + self-link escalation.
    expect(viewerTokens.some((token) => token.startsWith("vaultAccess:"))).toBe(false);
    // Admin/developer keep read; only the viewer is excluded.
    const developerTokens = MANAGED_POLICIES["managed:developer"].document.statements.flatMap(
      (stmt) => stmt.actions,
    );
    expect(developerTokens).toContain("vaultAccess:read");
  });
});

// The managed:viewer preset replaces the old built-in viewer role; what it must
// NOT grant (writes) is a security property of the new model — pin it end-to-end
// through the real evaluator.
const viewerActor: AuthContextShape = {
  userId: "u1",
  organizationId: "org-1",
  memberId: "m1",
  role: "viewer",
  isOwner: false,
  effectiveStatements: resolveManagedDocument("managed:viewer")?.statements ?? [],
  source: "session",
  transport: "cookie",
  actorEmail: "viewer@example.com",
  isSuperadmin: false,
};

describe("managed:viewer upper bound (via assertAccess)", () => {
  it.effect("allows a scoped read", () =>
    Effect.gen(function* () {
      const exit = yield* assertAccess("channel", "read", { kind: "project", projectId: "A" }).pipe(
        Effect.provideService(AuthContext, viewerActor),
        Effect.exit,
      );
      expect(Exit.isSuccess(exit)).toBe(true);
    }),
  );

  it.effect("denies a write (channel:create)", () =>
    Effect.gen(function* () {
      const exit = yield* assertAccess("channel", "create", {
        kind: "project",
        projectId: "A",
      }).pipe(Effect.provideService(AuthContext, viewerActor), Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  it.effect("denies vault read (viewer is not a vault participant)", () =>
    Effect.gen(function* () {
      const exit = yield* assertAccess("vaultAccess", "read").pipe(
        Effect.provideService(AuthContext, viewerActor),
        Effect.exit,
      );
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );
});
