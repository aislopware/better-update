import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { NotFound } from "../errors";
import { AppleTeamRepo } from "../repositories/apple-teams";
import { ProjectCredentialBindingRepo } from "../repositories/project-credential-bindings";
import {
  assertAppleCredentialAccess,
  assertAppleCredentialCreate,
  assertDeviceAccess,
  canReadAppleTeamCredentials,
  filterByAppleTeamRead,
  readableAppleTeamRowIds,
} from "./apple-team-access";
import { AuthContext } from "./context";

import type { AppleTeamModel, CredentialBindingType } from "../models";
import type { AppleTeamRepository } from "../repositories/apple-teams";
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

const actor = (overrides: Partial<AuthContextShape>): AuthContextShape => ({
  ...baseActor,
  ...overrides,
});

// v2 binding fixtures (spec §1a): the rank must be held on a project the
// TEAM is bound to — the same rank elsewhere no longer grants anything.
const developerOnBound = actor({ projectRoles: { projBound: "developer" } });
const maintainerOnBound = actor({ projectRoles: { projBound: "maintainer" } });
const reporterOnBound = actor({ projectRoles: { projBound: "reporter" } });
const maintainerElsewhere = actor({ projectRoles: { projOther: "maintainer" } });

const team = (id: string, appleTeamId: string, isProtected: boolean): AppleTeamModel => ({
  id,
  organizationId: "org-1",
  appleTeamId,
  appleTeamType: "COMPANY_ORGANIZATION",
  name: null,
  isProtected,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const OPEN_TEAM = team("row-open", "JMANGO1234", false);
const PROTECTED_TEAM = team("row-protected", "OTHER67890", true);
const UNBOUND_TEAM = team("row-unbound", "LONER11111", false);

// Bindings: both bound teams → projBound; the team-less ASC key "key-bound"
// carries its own row; UNBOUND_TEAM has none (admin-only).
const BINDINGS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  appleTeam: {
    [OPEN_TEAM.id]: ["projBound"],
    [PROTECTED_TEAM.id]: ["projBound"],
  },
  ascApiKey: { "key-bound": ["projBound"] },
};

const stubBindingRepo: ProjectCredentialBindingRepository = {
  boundProjectIds: ({ resourceType, resourceId }) =>
    Effect.succeed(BINDINGS[resourceType]?.[resourceId] ?? []),
  boundProjectIdsByResource: ({ resourceType }: { resourceType: CredentialBindingType }) =>
    Effect.succeed(BINDINGS[resourceType] ?? {}),
  listByProject: () => Effect.die(new Error("not stubbed")),
  bind: () => Effect.die(new Error("not stubbed")),
  unbind: () => Effect.die(new Error("not stubbed")),
  removeAllForResource: () => Effect.die(new Error("not stubbed")),
};

const stubTeamRepo = (overrides: Partial<AppleTeamRepository>): AppleTeamRepository => ({
  upsertByAppleTeamId: () => Effect.die(new Error("not stubbed")),
  findById: () => Effect.fail(new NotFound({ message: "Apple team not found" })),
  findByAppleTeamId: () => Effect.fail(new NotFound({ message: "Apple team not found" })),
  listWithCounts: () => Effect.die(new Error("not stubbed")),
  listByOrg: () => Effect.succeed([OPEN_TEAM, PROTECTED_TEAM, UNBOUND_TEAM]),
  setProtection: () => Effect.die(new Error("not stubbed")),
  delete: () => Effect.die(new Error("not stubbed")),
  ...overrides,
});

const teamsByRowId = new Map([
  [OPEN_TEAM.id, OPEN_TEAM],
  [PROTECTED_TEAM.id, PROTECTED_TEAM],
  [UNBOUND_TEAM.id, UNBOUND_TEAM],
]);

const lookupRepo = stubTeamRepo({
  findById: ({ id }) => {
    const found = teamsByRowId.get(id);
    return found
      ? Effect.succeed(found)
      : Effect.fail(new NotFound({ message: "Apple team not found" }));
  },
  findByAppleTeamId: ({ appleTeamId }) => {
    const found = [...teamsByRowId.values()].find((row) => row.appleTeamId === appleTeamId);
    return found
      ? Effect.succeed(found)
      : Effect.fail(new NotFound({ message: "Apple team not found" }));
  },
});

const runWith =
  (ctx: AuthContextShape, repo: AppleTeamRepository = lookupRepo) =>
  <Value, Err>(
    effect: Effect.Effect<Value, Err, AuthContext | AppleTeamRepo | ProjectCredentialBindingRepo>,
  ) =>
    effect.pipe(
      Effect.provideService(AuthContext, ctx),
      Effect.provideService(AppleTeamRepo, repo),
      Effect.provideService(ProjectCredentialBindingRepo, stubBindingRepo),
    );

const isForbidden = (effect: Effect.Effect<unknown, unknown>) =>
  Effect.gen(function* () {
    const exit = yield* effect.pipe(Effect.exit);
    return Exit.isFailure(exit);
  });

describe(canReadAppleTeamCredentials, () => {
  it("owner, superadmin and org admin read every team", () => {
    expect(canReadAppleTeamCredentials(actor({ isOwner: true }), PROTECTED_TEAM, [])).toBe(true);
    expect(canReadAppleTeamCredentials(actor({ isSuperadmin: true }), null, [])).toBe(true);
    expect(canReadAppleTeamCredentials(actor({ orgRole: "admin" }), PROTECTED_TEAM, [])).toBe(true);
  });

  it("developer on a BOUND project reads non-protected teams only", () => {
    expect(canReadAppleTeamCredentials(developerOnBound, OPEN_TEAM, ["projBound"])).toBe(true);
    expect(canReadAppleTeamCredentials(developerOnBound, PROTECTED_TEAM, ["projBound"])).toBe(
      false,
    );
    expect(canReadAppleTeamCredentials(developerOnBound, null, [])).toBe(false);
  });

  it("maintainer on a bound project reads protected; rank elsewhere grants nothing", () => {
    expect(canReadAppleTeamCredentials(maintainerOnBound, PROTECTED_TEAM, ["projBound"])).toBe(
      true,
    );
    expect(canReadAppleTeamCredentials(maintainerElsewhere, OPEN_TEAM, ["projBound"])).toBe(false);
    expect(canReadAppleTeamCredentials(reporterOnBound, OPEN_TEAM, ["projBound"])).toBe(false);
  });

  it("an unbound team is invisible to every member", () => {
    expect(canReadAppleTeamCredentials(maintainerOnBound, UNBOUND_TEAM, [])).toBe(false);
  });
});

describe(filterByAppleTeamRead, () => {
  const items = [
    { id: "c-open", appleTeamId: OPEN_TEAM.id },
    { id: "c-protected", appleTeamId: PROTECTED_TEAM.id },
    { id: "c-unbound", appleTeamId: UNBOUND_TEAM.id },
    { id: "c-teamless", appleTeamId: null },
    { id: "c-dangling", appleTeamId: "row-dangling" },
  ];

  it.effect("owner sees everything (repo untouched)", () =>
    Effect.gen(function* () {
      const visible = yield* filterByAppleTeamRead(items, (item) => item.appleTeamId).pipe(
        runWith(
          actor({ isOwner: true }),
          stubTeamRepo({ listByOrg: () => Effect.die(new Error("must not be called")) }),
        ),
      );
      expect(visible).toStrictEqual(items);
    }),
  );

  it.effect("developer sees bound non-protected rows only — never unbound or dangling", () =>
    Effect.gen(function* () {
      const visible = yield* filterByAppleTeamRead(items, (item) => item.appleTeamId).pipe(
        runWith(developerOnBound),
      );
      expect(visible.map((item) => item.id)).toStrictEqual(["c-open"]);
    }),
  );

  it.effect("maintainer on the bound project additionally sees protected rows", () =>
    Effect.gen(function* () {
      const visible = yield* filterByAppleTeamRead(items, (item) => item.appleTeamId).pipe(
        runWith(maintainerOnBound),
      );
      expect(visible.map((item) => item.id)).toStrictEqual(["c-open", "c-protected"]);
    }),
  );

  it.effect("maintainer elsewhere sees nothing", () =>
    Effect.gen(function* () {
      const visible = yield* filterByAppleTeamRead(items, (item) => item.appleTeamId).pipe(
        runWith(maintainerElsewhere),
      );
      expect(visible).toStrictEqual([]);
    }),
  );

  it.effect("team-less rows surface via their own ascApiKey binding", () =>
    Effect.gen(function* () {
      const keys = [
        { id: "key-bound", appleTeamId: null },
        { id: "key-unbound", appleTeamId: null },
      ];
      const visible = yield* filterByAppleTeamRead(keys, (item) => item.appleTeamId, {
        teamlessBindingIdOf: (item) => item.id,
      }).pipe(runWith(maintainerOnBound));
      expect(visible.map((item) => item.id)).toStrictEqual(["key-bound"]);
    }),
  );
});

describe(assertAppleCredentialAccess, () => {
  it.effect("developer downloads from a bound non-protected team, not a protected one", () =>
    Effect.gen(function* () {
      const open = yield* isForbidden(
        assertAppleCredentialAccess({ action: "download", appleTeamRowId: OPEN_TEAM.id }).pipe(
          runWith(developerOnBound),
        ),
      );
      const guarded = yield* isForbidden(
        assertAppleCredentialAccess({ action: "download", appleTeamRowId: PROTECTED_TEAM.id }).pipe(
          runWith(developerOnBound),
        ),
      );
      expect(open).toBe(false);
      expect(guarded).toBe(true);
    }),
  );

  it.effect("rank on an unrelated project does not open a bound team", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAppleCredentialAccess({ action: "read", appleTeamRowId: OPEN_TEAM.id }).pipe(
          runWith(maintainerElsewhere),
        ),
      );
      expect(forbidden).toBe(true);
    }),
  );

  it.effect("an unbound team is admin-only", () =>
    Effect.gen(function* () {
      const asMaintainer = yield* isForbidden(
        assertAppleCredentialAccess({ action: "read", appleTeamRowId: UNBOUND_TEAM.id }).pipe(
          runWith(maintainerOnBound),
        ),
      );
      const asAdmin = yield* isForbidden(
        assertAppleCredentialAccess({ action: "read", appleTeamRowId: UNBOUND_TEAM.id }).pipe(
          runWith(actor({ orgRole: "admin" })),
        ),
      );
      expect(asMaintainer).toBe(true);
      expect(asAdmin).toBe(false);
    }),
  );

  it.effect("delete requires maintainer even on a bound non-protected team", () =>
    Effect.gen(function* () {
      const asDeveloper = yield* isForbidden(
        assertAppleCredentialAccess({ action: "delete", appleTeamRowId: OPEN_TEAM.id }).pipe(
          runWith(developerOnBound),
        ),
      );
      const asMaintainer = yield* isForbidden(
        assertAppleCredentialAccess({ action: "delete", appleTeamRowId: OPEN_TEAM.id }).pipe(
          runWith(maintainerOnBound),
        ),
      );
      expect(asDeveloper).toBe(true);
      expect(asMaintainer).toBe(false);
    }),
  );

  it.effect("team-less keys gate on their own binding (always protected)", () =>
    Effect.gen(function* () {
      const boundKey = yield* isForbidden(
        assertAppleCredentialAccess({
          action: "read",
          appleTeamRowId: null,
          ascApiKeyId: "key-bound",
        }).pipe(runWith(maintainerOnBound)),
      );
      const unboundKey = yield* isForbidden(
        assertAppleCredentialAccess({
          action: "read",
          appleTeamRowId: null,
          ascApiKeyId: "key-unbound",
        }).pipe(runWith(maintainerOnBound)),
      );
      const developerBoundKey = yield* isForbidden(
        assertAppleCredentialAccess({
          action: "read",
          appleTeamRowId: null,
          ascApiKeyId: "key-bound",
        }).pipe(runWith(developerOnBound)),
      );
      expect(boundKey).toBe(false);
      expect(unboundKey).toBe(true);
      expect(developerBoundKey).toBe(true);
    }),
  );

  it.effect("owner skips the team lookup entirely", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAppleCredentialAccess({ action: "delete", appleTeamRowId: OPEN_TEAM.id }).pipe(
          runWith(
            actor({ isOwner: true }),
            stubTeamRepo({ findById: () => Effect.die(new Error("must not be called")) }),
          ),
        ),
      );
      expect(forbidden).toBe(false);
    }),
  );
});

describe(assertAppleCredentialCreate, () => {
  it.effect("existing bound team: developer creates under non-protected only", () =>
    Effect.gen(function* () {
      const open = yield* isForbidden(
        assertAppleCredentialCreate({ appleTeamIdentifier: OPEN_TEAM.appleTeamId }).pipe(
          runWith(developerOnBound),
        ),
      );
      const guarded = yield* isForbidden(
        assertAppleCredentialCreate({ appleTeamIdentifier: PROTECTED_TEAM.appleTeamId }).pipe(
          runWith(developerOnBound),
        ),
      );
      expect(open).toBe(false);
      expect(guarded).toBe(true);
    }),
  );

  it.effect("NEW team requires projectId + Maintainer there (auto-bind path)", () =>
    Effect.gen(function* () {
      const withoutProject = yield* isForbidden(
        assertAppleCredentialCreate({ appleTeamIdentifier: "NEWTEAM123" }).pipe(
          runWith(maintainerOnBound),
        ),
      );
      const asMaintainer = yield* isForbidden(
        assertAppleCredentialCreate({
          appleTeamIdentifier: "NEWTEAM123",
          projectId: "projBound",
        }).pipe(runWith(maintainerOnBound)),
      );
      const asDeveloper = yield* isForbidden(
        assertAppleCredentialCreate({
          appleTeamIdentifier: "NEWTEAM123",
          projectId: "projBound",
        }).pipe(runWith(developerOnBound)),
      );
      expect(withoutProject).toBe(true);
      expect(asMaintainer).toBe(false);
      expect(asDeveloper).toBe(true);
    }),
  );

  it.effect("team-less key follows the same maintainer auto-bind rule", () =>
    Effect.gen(function* () {
      const withoutProject = yield* isForbidden(
        assertAppleCredentialCreate({ appleTeamIdentifier: undefined }).pipe(
          runWith(maintainerOnBound),
        ),
      );
      const withProject = yield* isForbidden(
        assertAppleCredentialCreate({
          appleTeamIdentifier: undefined,
          projectId: "projBound",
        }).pipe(runWith(maintainerOnBound)),
      );
      expect(withoutProject).toBe(true);
      expect(withProject).toBe(false);
    }),
  );

  it.effect("binding a pre-existing team to a NEW project is refused for members", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAppleCredentialCreate({
          appleTeamIdentifier: OPEN_TEAM.appleTeamId,
          projectId: "projOther",
        }).pipe(runWith(actor({ projectRoles: { projOther: "maintainer" } }))),
      );
      expect(forbidden).toBe(true);
    }),
  );

  it.effect("org admin passes without any project context", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAppleCredentialCreate({ appleTeamIdentifier: "NEWTEAM123" }).pipe(
          runWith(actor({ orgRole: "admin" })),
        ),
      );
      expect(forbidden).toBe(false);
    }),
  );
});

describe("assertDeviceAccess / readableAppleTeamRowIds", () => {
  it.effect("devices ride their team's binding; team-less devices are admin-only", () =>
    Effect.gen(function* () {
      const boundTeam = yield* isForbidden(
        assertDeviceAccess({ action: "create", appleTeamRowId: OPEN_TEAM.id }).pipe(
          runWith(developerOnBound),
        ),
      );
      const teamless = yield* isForbidden(
        assertDeviceAccess({ action: "create", appleTeamRowId: null }).pipe(
          runWith(maintainerOnBound),
        ),
      );
      const teamlessAdmin = yield* isForbidden(
        assertDeviceAccess({ action: "create", appleTeamRowId: null }).pipe(
          runWith(actor({ orgRole: "admin" })),
        ),
      );
      expect(boundTeam).toBe(false);
      expect(teamless).toBe(true);
      expect(teamlessAdmin).toBe(false);
    }),
  );

  it.effect("protected team raises the device gate to maintainer", () =>
    Effect.gen(function* () {
      const asDeveloper = yield* isForbidden(
        assertDeviceAccess({ action: "read", appleTeamRowId: PROTECTED_TEAM.id }).pipe(
          runWith(developerOnBound),
        ),
      );
      const asMaintainer = yield* isForbidden(
        assertDeviceAccess({ action: "read", appleTeamRowId: PROTECTED_TEAM.id }).pipe(
          runWith(maintainerOnBound),
        ),
      );
      expect(asDeveloper).toBe(true);
      expect(asMaintainer).toBe(false);
    }),
  );

  it.effect("readableAppleTeamRowIds scopes members and short-circuits admins", () =>
    Effect.gen(function* () {
      const admin = yield* readableAppleTeamRowIds.pipe(
        runWith(
          actor({ orgRole: "admin" }),
          stubTeamRepo({ listByOrg: () => Effect.die(new Error("must not be called")) }),
        ),
      );
      const developer = yield* readableAppleTeamRowIds.pipe(runWith(developerOnBound));
      const maintainer = yield* readableAppleTeamRowIds.pipe(runWith(maintainerOnBound));
      expect(admin).toBe("all");
      expect(developer).toStrictEqual([OPEN_TEAM.id]);
      expect(maintainer).toStrictEqual([OPEN_TEAM.id, PROTECTED_TEAM.id]);
    }),
  );
});
