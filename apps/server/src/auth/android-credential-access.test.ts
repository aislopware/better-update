import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { ProjectCredentialBindingRepo } from "../repositories/project-credential-bindings";
import {
  assertAndroidOrgCredentialAccess,
  assertAndroidOrgCredentialCreate,
  filterAndroidOrgCredentialRead,
} from "./android-credential-access";
import { AuthContext } from "./context";
import { assertPermission } from "./permissions";

import type { ProjectCredentialBindingRepository } from "../repositories/project-credential-bindings";
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

// Binding fixtures (spec §1a): keystore "ks-bound" and GSA key "gsa-bound"
// are bound to projBound; "*-unbound" rows have no binding (admin-only).
const BINDINGS: Readonly<Record<string, readonly string[]>> = {
  "ks-bound": ["projBound"],
  "gsa-bound": ["projBound"],
};

const stubBindingRepo: ProjectCredentialBindingRepository = {
  boundProjectIds: ({ resourceId }) => Effect.succeed(BINDINGS[resourceId] ?? []),
  boundProjectIdsByResource: () => Effect.succeed(BINDINGS),
  listByProject: () => Effect.die(new Error("not stubbed")),
  bind: () => Effect.die(new Error("not stubbed")),
  unbind: () => Effect.die(new Error("not stubbed")),
  removeAllForResource: () => Effect.die(new Error("not stubbed")),
};

const provide = (overrides: Partial<AuthContextShape>) => {
  const withActor = Effect.provideService(AuthContext, { ...baseActor, ...overrides });
  return <Value, Err>(
    effect: Effect.Effect<Value, Err, AuthContext | ProjectCredentialBindingRepo>,
  ) => effect.pipe(Effect.provideService(ProjectCredentialBindingRepo, stubBindingRepo), withActor);
};

const isForbidden = (effect: Effect.Effect<unknown, unknown>) =>
  Effect.gen(function* () {
    const exit = yield* effect.pipe(Effect.exit);
    return Exit.isFailure(exit);
  });

describe(assertAndroidOrgCredentialAccess, () => {
  it.effect("developer on a BOUND project uses non-protected rows; reporter cannot", () =>
    Effect.gen(function* () {
      const asDeveloper = yield* isForbidden(
        assertAndroidOrgCredentialAccess({
          action: "download",
          resourceType: "androidUploadKeystore",
          resourceId: "ks-bound",
          isProtected: false,
        }).pipe(provide({ projectRoles: { projBound: "developer" } })),
      );
      const asReporter = yield* isForbidden(
        assertAndroidOrgCredentialAccess({
          action: "download",
          resourceType: "androidUploadKeystore",
          resourceId: "ks-bound",
          isProtected: false,
        }).pipe(provide({ projectRoles: { projBound: "reporter" } })),
      );
      expect(asDeveloper).toBe(false);
      expect(asReporter).toBe(true);
    }),
  );

  it.effect("rank on an UNRELATED project grants nothing (binding gate, §1a)", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAndroidOrgCredentialAccess({
          action: "read",
          resourceType: "androidUploadKeystore",
          resourceId: "ks-bound",
          isProtected: false,
        }).pipe(provide({ projectRoles: { projOther: "maintainer" } })),
      );
      expect(forbidden).toBe(true);
    }),
  );

  it.effect("an unbound row is admin-only", () =>
    Effect.gen(function* () {
      const asMaintainer = yield* isForbidden(
        assertAndroidOrgCredentialAccess({
          action: "read",
          resourceType: "googleServiceAccountKey",
          resourceId: "gsa-unbound",
          isProtected: false,
        }).pipe(provide({ projectRoles: { projBound: "maintainer" } })),
      );
      const asAdmin = yield* isForbidden(
        assertAndroidOrgCredentialAccess({
          action: "read",
          resourceType: "googleServiceAccountKey",
          resourceId: "gsa-unbound",
          isProtected: false,
        }).pipe(provide({ orgRole: "admin" })),
      );
      expect(asMaintainer).toBe(true);
      expect(asAdmin).toBe(false);
    }),
  );

  it.effect("a protected row raises the requirement to maintainer (§3b)", () =>
    Effect.gen(function* () {
      const asDeveloper = yield* isForbidden(
        assertAndroidOrgCredentialAccess({
          action: "read",
          resourceType: "googleServiceAccountKey",
          resourceId: "gsa-bound",
          isProtected: true,
        }).pipe(provide({ projectRoles: { projBound: "developer" } })),
      );
      const asMaintainer = yield* isForbidden(
        assertAndroidOrgCredentialAccess({
          action: "read",
          resourceType: "googleServiceAccountKey",
          resourceId: "gsa-bound",
          isProtected: true,
        }).pipe(provide({ projectRoles: { projBound: "maintainer" } })),
      );
      expect(asDeveloper).toBe(true);
      expect(asMaintainer).toBe(false);
    }),
  );

  it.effect("owner bypasses", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAndroidOrgCredentialAccess({
          action: "delete",
          resourceType: "androidUploadKeystore",
          resourceId: "ks-unbound",
          isProtected: true,
        }).pipe(provide({ isOwner: true, orgRole: "owner" })),
      );
      expect(forbidden).toBe(false);
    }),
  );
});

describe(assertAndroidOrgCredentialCreate, () => {
  it.effect("member needs Maintainer on the auto-bind project; admin passes bare", () =>
    Effect.gen(function* () {
      const withoutProject = yield* isForbidden(
        assertAndroidOrgCredentialCreate({}).pipe(
          provide({ projectRoles: { projBound: "maintainer" } }),
        ),
      );
      const asMaintainer = yield* isForbidden(
        assertAndroidOrgCredentialCreate({ projectId: "projBound" }).pipe(
          provide({ projectRoles: { projBound: "maintainer" } }),
        ),
      );
      const asDeveloper = yield* isForbidden(
        assertAndroidOrgCredentialCreate({ projectId: "projBound" }).pipe(
          provide({ projectRoles: { projBound: "developer" } }),
        ),
      );
      const asAdmin = yield* isForbidden(
        assertAndroidOrgCredentialCreate({}).pipe(provide({ orgRole: "admin" })),
      );
      expect(withoutProject).toBe(true);
      expect(asMaintainer).toBe(false);
      expect(asDeveloper).toBe(true);
      expect(asAdmin).toBe(false);
    }),
  );
});

describe(filterAndroidOrgCredentialRead, () => {
  const items = [
    { id: "ks-bound", isProtected: false },
    { id: "ks-protected-bound", isProtected: true },
    { id: "ks-unbound", isProtected: false },
  ];

  it.effect("members see bound rows at their rank; admins see everything", () =>
    Effect.gen(function* () {
      const asDeveloper = yield* filterAndroidOrgCredentialRead(
        items,
        "androidUploadKeystore",
        (item) => item,
      ).pipe(provide({ projectRoles: { projBound: "developer" } }));
      const asAdmin = yield* filterAndroidOrgCredentialRead(
        items,
        "androidUploadKeystore",
        (item) => item,
      ).pipe(provide({ orgRole: "admin" }));
      expect(asDeveloper.map((item) => item.id)).toStrictEqual(["ks-bound"]);
      expect(asAdmin).toStrictEqual(items);
    }),
  );
});

describe(assertPermission, () => {
  it.effect("is assertAccess at the org target (webhook admin rule)", () =>
    Effect.gen(function* () {
      const asAdmin = yield* isForbidden(
        assertPermission("webhook", "read").pipe(provide({ orgRole: "admin" })),
      );
      const asMember = yield* isForbidden(assertPermission("webhook", "read").pipe(provide({})));
      expect(asAdmin).toBe(false);
      expect(asMember).toBe(true);
    }),
  );
});
