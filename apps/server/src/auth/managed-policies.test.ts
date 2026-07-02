import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { AuthContext } from "./context";
import {
  ADMIN_POLICY_ID,
  isManagedPolicyId,
  MANAGED_POLICY_LIST,
  managedPolicyModel,
  resolveManagedDocument,
} from "./managed-policies";
import { assertAccess } from "./policy";

import type { AuthContextShape } from "./context";

describe(isManagedPolicyId, () => {
  it("accepts exactly managed:admin", () => {
    expect(isManagedPolicyId(ADMIN_POLICY_ID)).toBe(true);
  });

  it("rejects every removed or malformed managed id", () => {
    for (const id of [
      "managed:owner",
      "managed:bogus",
      "managed:",
      // The old presets, capabilities, and parameterized project roles are
      // GONE (migrations 0083/0084 dropped their rows).
      "managed:developer",
      "managed:viewer",
      "managed:maintainer",
      "managed:developer@*",
      "managed:maintainer@proj-1",
      "managed:cap-credentials",
      "managed:cap-auditor",
      "managed:cap-billing",
      "admin",
      "managed",
      "",
    ]) {
      expect(isManagedPolicyId(id)).toBe(false);
      expect(resolveManagedDocument(id)).toBeNull();
      expect(managedPolicyModel(id)).toBeNull();
    }
  });
});

describe("MANAGED_POLICY_LIST contents", () => {
  it("is exactly the admin preset, org '*', with a description", () => {
    expect(MANAGED_POLICY_LIST.map((policy) => policy.id)).toStrictEqual(["managed:admin"]);
    expect(MANAGED_POLICY_LIST.every((policy) => policy.organizationId === "*")).toBe(true);
    expect(MANAGED_POLICY_LIST.every((policy) => (policy.description ?? "").length > 0)).toBe(true);
  });

  it("admin grants org-wide management tokens", () => {
    const tokens =
      resolveManagedDocument(ADMIN_POLICY_ID)?.statements.flatMap((stmt) => stmt.actions) ?? [];
    expect(tokens).toContain("policy:create");
    expect(tokens).toContain("channel:create");
    expect(tokens).toContain("environment:update");
    expect(tokens).toContain("vaultAccess:read");
    expect(
      resolveManagedDocument(ADMIN_POLICY_ID)?.statements.every(
        (stmt) => stmt.effect === "allow" && stmt.resources[0] === "*",
      ),
    ).toBe(true);
  });
});

// End-to-end pin through the real evaluator: an admin attachment authorizes
// org-wide writes; a principal without it is default-denied.
const actorWith = (statements: AuthContextShape["effectiveStatements"]): AuthContextShape => ({
  userId: "u1",
  organizationId: "org-1",
  memberId: "m1",
  role: "member",
  isOwner: false,
  effectiveStatements: statements,
  source: "session",
  transport: "cookie",
  sessionId: "sess-test",
  actorEmail: "member@example.com",
  isSuperadmin: false,
  robotId: null,
});

describe("managed:admin via assertAccess", () => {
  it.effect("authorizes an org-wide write", () =>
    Effect.gen(function* () {
      const admin = actorWith(resolveManagedDocument(ADMIN_POLICY_ID)?.statements ?? []);
      const exit = yield* assertAccess("channel", "create", {
        kind: "environment",
        projectId: "A",
        environment: "preview",
      }).pipe(Effect.provideService(AuthContext, admin), Effect.exit);
      expect(Exit.isSuccess(exit)).toBe(true);
    }),
  );

  it.effect("a principal with no attachments is default-denied", () =>
    Effect.gen(function* () {
      const nobody = actorWith([]);
      const exit = yield* assertAccess("channel", "read", { kind: "project", projectId: "A" }).pipe(
        Effect.provideService(AuthContext, nobody),
        Effect.exit,
      );
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );
});
