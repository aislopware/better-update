import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { NotFound } from "../errors";
import { AppleTeamRepo } from "../repositories/apple-teams";
import {
  assertAppleCredentialAccess,
  assertAppleCredentialCreate,
  canReadAppleTeamCredentials,
  filterByAppleTeamRead,
} from "./apple-team-access";
import { AuthContext } from "./context";

import type { PolicyStatement } from "../authz-models";
import type { AppleTeamModel } from "../models";
import type { AppleTeamRepository } from "../repositories/apple-teams";
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
  robotId: null,
};

const actor = (overrides: Partial<AuthContextShape>): AuthContextShape => ({
  ...baseActor,
  ...overrides,
});

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

const team = (id: string, appleTeamId: string): AppleTeamModel => ({
  id,
  organizationId: "org-1",
  appleTeamId,
  appleTeamType: "COMPANY_ORGANIZATION",
  name: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const JMANGO = team("row-jm", "JMANGO1234");
const OTHER = team("row-other", "OTHER67890");

const stubTeamRepo = (overrides: Partial<AppleTeamRepository>): AppleTeamRepository => ({
  upsertByAppleTeamId: () => Effect.die(new Error("not stubbed")),
  findById: () => Effect.fail(new NotFound({ message: "Apple team not found" })),
  findByAppleTeamId: () => Effect.fail(new NotFound({ message: "Apple team not found" })),
  listWithCounts: () => Effect.die(new Error("not stubbed")),
  listByOrg: () => Effect.succeed([JMANGO, OTHER]),
  delete: () => Effect.die(new Error("not stubbed")),
  ...overrides,
});

const runWith =
  (ctx: AuthContextShape, repo: AppleTeamRepository = stubTeamRepo({})) =>
  <Value, Err>(effect: Effect.Effect<Value, Err, AuthContext | AppleTeamRepo>) =>
    effect.pipe(
      Effect.provideService(AuthContext, ctx),
      Effect.provideService(AppleTeamRepo, repo),
    );

const isForbidden = (effect: Effect.Effect<unknown, unknown>) =>
  Effect.gen(function* () {
    const exit = yield* effect.pipe(Effect.exit);
    return Exit.isFailure(exit);
  });

describe(canReadAppleTeamCredentials, () => {
  it("owner and superadmin read every team", () => {
    expect(canReadAppleTeamCredentials(actor({ isOwner: true }), "OTHER67890")).toBe(true);
    expect(canReadAppleTeamCredentials(actor({ isSuperadmin: true }), null)).toBe(true);
  });

  it("a team selector covers its own team only", () => {
    const ctx = actor({
      effectiveStatements: [allow(["appleCredential:read"], ["appleTeam/JMANGO1234"])],
    });
    expect(canReadAppleTeamCredentials(ctx, "JMANGO1234")).toBe(true);
    expect(canReadAppleTeamCredentials(ctx, "OTHER67890")).toBe(false);
    expect(canReadAppleTeamCredentials(ctx, null)).toBe(false);
  });

  it("the credential-collection selector qualifies too", () => {
    const ctx = actor({
      effectiveStatements: [allow(["appleCredential:read"], ["appleTeam/JMANGO1234/credential"])],
    });
    expect(canReadAppleTeamCredentials(ctx, "JMANGO1234")).toBe(true);
  });

  it("team-wide selectors reach team-less credentials", () => {
    for (const selector of ["*", "appleTeam", "appleTeam/*"]) {
      const ctx = actor({ effectiveStatements: [allow(["appleCredential:read"], [selector])] });
      expect(canReadAppleTeamCredentials(ctx, null)).toBe(true);
      expect(canReadAppleTeamCredentials(ctx, "JMANGO1234")).toBe(true);
    }
  });
});

describe(filterByAppleTeamRead, () => {
  const items = [
    { id: "c1", appleTeamId: JMANGO.id },
    { id: "c2", appleTeamId: OTHER.id },
    { id: "c3", appleTeamId: null },
    { id: "c4", appleTeamId: "row-dangling" },
  ];

  it.effect("owner sees everything (repo untouched)", () =>
    Effect.gen(function* () {
      const visible = yield* filterByAppleTeamRead(
        items,
        (item) => item.appleTeamId,
        (item) => item.id,
      ).pipe(
        runWith(
          actor({ isOwner: true }),
          stubTeamRepo({ listByOrg: () => Effect.die(new Error("must not be called")) }),
        ),
      );
      expect(visible).toStrictEqual(items);
    }),
  );

  it.effect("team-scoped actor sees only its team's rows", () =>
    Effect.gen(function* () {
      const ctx = actor({
        effectiveStatements: [allow(["appleCredential:read"], [`appleTeam/${JMANGO.appleTeamId}`])],
      });
      const visible = yield* filterByAppleTeamRead(
        items,
        (item) => item.appleTeamId,
        (item) => item.id,
      ).pipe(runWith(ctx));
      expect(visible.map((item) => item.id)).toStrictEqual(["c1"]);
    }),
  );

  it.effect("wide selector includes team-less rows but never dangling references", () =>
    Effect.gen(function* () {
      const ctx = actor({ effectiveStatements: [allow(["appleCredential:*"], ["appleTeam"])] });
      const visible = yield* filterByAppleTeamRead(
        items,
        (item) => item.appleTeamId,
        (item) => item.id,
      ).pipe(runWith(ctx));
      expect(visible.map((item) => item.id)).toStrictEqual(["c1", "c2", "c3"]);
    }),
  );

  it.effect("an item-level deny hides that row even under a team-wide allow", () =>
    Effect.gen(function* () {
      const ctx = actor({
        effectiveStatements: [
          allow(["appleCredential:read"], [`appleTeam/${JMANGO.appleTeamId}`]),
          deny(["appleCredential:read"], [`appleTeam/${JMANGO.appleTeamId}/credential/c1`]),
        ],
      });
      const visible = yield* filterByAppleTeamRead(
        items,
        (item) => item.appleTeamId,
        (item) => item.id,
      ).pipe(runWith(ctx));
      expect(visible.map((item) => item.id)).toStrictEqual([]);
    }),
  );

  it.effect("an item-level allow surfaces a single credential's row", () =>
    Effect.gen(function* () {
      const ctx = actor({
        effectiveStatements: [
          allow(["appleCredential:read"], [`appleTeam/${JMANGO.appleTeamId}/credential/c1`]),
        ],
      });
      const visible = yield* filterByAppleTeamRead(
        items,
        (item) => item.appleTeamId,
        (item) => item.id,
      ).pipe(runWith(ctx));
      expect(visible.map((item) => item.id)).toStrictEqual(["c1"]);
    }),
  );
});

describe("assertAppleCredentialAccess / assertAppleCredentialCreate", () => {
  const jmangoScoped = actor({
    effectiveStatements: [allow(["appleCredential:*"], [`appleTeam/${JMANGO.appleTeamId}`])],
  });
  const teamsByRowId = new Map([
    [JMANGO.id, JMANGO],
    [OTHER.id, OTHER],
  ]);
  const repo = stubTeamRepo({
    findById: ({ id }) => {
      const found = teamsByRowId.get(id);
      return found
        ? Effect.succeed(found)
        : Effect.fail(new NotFound({ message: "Apple team not found" }));
    },
  });

  it.effect("allows an object in the granted team, forbids the other team", () =>
    Effect.gen(function* () {
      const own = yield* isForbidden(
        assertAppleCredentialAccess({
          action: "delete",
          credentialId: "c1",
          appleTeamRowId: JMANGO.id,
        }).pipe(runWith(jmangoScoped, repo)),
      );
      const other = yield* isForbidden(
        assertAppleCredentialAccess({
          action: "delete",
          credentialId: "c2",
          appleTeamRowId: OTHER.id,
        }).pipe(runWith(jmangoScoped, repo)),
      );
      expect(own).toBe(false);
      expect(other).toBe(true);
    }),
  );

  it.effect("team-less objects require a team-wide grant", () =>
    Effect.gen(function* () {
      const scoped = yield* isForbidden(
        assertAppleCredentialAccess({
          action: "download",
          credentialId: "c3",
          appleTeamRowId: null,
        }).pipe(runWith(jmangoScoped, repo)),
      );
      const wide = yield* isForbidden(
        assertAppleCredentialAccess({
          action: "download",
          credentialId: "c3",
          appleTeamRowId: null,
        }).pipe(
          runWith(
            actor({ effectiveStatements: [allow(["appleCredential:*"], ["appleTeam/*"])] }),
            repo,
          ),
        ),
      );
      expect(scoped).toBe(true);
      expect(wide).toBe(false);
    }),
  );

  it.effect("owner skips the team lookup entirely", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAppleCredentialAccess({
          action: "delete",
          credentialId: "c1",
          appleTeamRowId: JMANGO.id,
        }).pipe(
          runWith(
            actor({ isOwner: true }),
            stubTeamRepo({ findById: () => Effect.die(new Error("must not be called")) }),
          ),
        ),
      );
      expect(forbidden).toBe(false);
    }),
  );

  it.effect("create gates on the payload team before any row exists", () =>
    Effect.gen(function* () {
      const own = yield* isForbidden(
        assertAppleCredentialCreate(JMANGO.appleTeamId).pipe(runWith(jmangoScoped, repo)),
      );
      const other = yield* isForbidden(
        assertAppleCredentialCreate(OTHER.appleTeamId).pipe(runWith(jmangoScoped, repo)),
      );
      const teamless = yield* isForbidden(
        assertAppleCredentialCreate(undefined).pipe(runWith(jmangoScoped, repo)),
      );
      expect(own).toBe(false);
      expect(other).toBe(true);
      expect(teamless).toBe(true);
    }),
  );
});
