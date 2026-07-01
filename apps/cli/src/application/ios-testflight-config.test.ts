import { it } from "@effect/vitest";
import { Effect } from "effect";

// eslint-disable-next-line import-plugin/no-namespace -- vi.mock factory return must satisfy the full module namespace type
import type * as AppleUtilsModule from "@expo/apple-utils";

import { buildTokenRequestContext } from "../lib/apple-asc-connect";
import { makeOutputModeLayer } from "../lib/output-mode";
import {
  applyTestFlightConfig,
  classifyProcessingState,
  findBuildByVersion,
  matchBetaGroupsByName,
  needsTestFlightConfig,
  resolveTestFlightAppId,
} from "./ios-testflight-config";

import type { AscCredentials } from "../lib/asc-credentials";
import type { OutputMode } from "../lib/output-mode";

// ── module mocks ────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  tokenCtor: vi.fn<(opts: unknown) => void>(),
  appFindAsync: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  buildGetAsync: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(),
  betaGroupGetAsync: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(),
  betaLocCreateAsync: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock(import("@expo/apple-utils"), () => {
  // `new Token(opts)` records its args in tokenCtor.mock.calls (vi.fn is newable).
  const mocked = {
    Token: mocks.tokenCtor,
    App: { findAsync: mocks.appFindAsync },
    Build: { getAsync: mocks.buildGetAsync },
    BetaGroup: { getAsync: mocks.betaGroupGetAsync },
    BetaBuildLocalization: { createAsync: mocks.betaLocCreateAsync },
  };
  return { ...mocked, default: mocked } as unknown as typeof AppleUtilsModule;
});

// ── helpers ─────────────────────────────────────────────────────

const CREDS: AscCredentials = { keyId: "K1", issuerId: "ISS-UUID", p8Pem: "PEM" };

interface FakeBuild {
  readonly id: string;
  readonly attributes: { readonly version: string; readonly processingState: string };
  readonly getBetaBuildLocalizationsAsync: ReturnType<typeof vi.fn>;
  readonly addBetaGroupsAsync: ReturnType<typeof vi.fn>;
}

const makeBuild = (id: string, processingState: string, version = "42"): FakeBuild => ({
  id,
  attributes: { version, processingState },
  getBetaBuildLocalizationsAsync: vi.fn<() => Promise<unknown[]>>(async () => []),
  addBetaGroupsAsync: vi.fn<() => Promise<void>>(async () => undefined),
});

const group = (id: string, name: string) => ({ id, attributes: { name } });

const withOutput = <Result, Err>(program: Effect.Effect<Result, Err, OutputMode>) =>
  program.pipe(Effect.provide(makeOutputModeLayer(false)));

beforeEach(() => {
  mocks.tokenCtor.mockClear();
  mocks.appFindAsync.mockReset();
  mocks.buildGetAsync.mockReset();
  mocks.betaGroupGetAsync.mockReset();
  mocks.betaLocCreateAsync.mockReset();
});

// ── pure helpers ────────────────────────────────────────────────

describe(classifyProcessingState, () => {
  it("maps VALID to valid", () => {
    expect(classifyProcessingState("VALID")).toBe("valid");
  });
  it("maps FAILED and INVALID to failed", () => {
    expect(classifyProcessingState("FAILED")).toBe("failed");
    expect(classifyProcessingState("INVALID")).toBe("failed");
  });
  it("treats PROCESSING, unknown, and null as still-processing", () => {
    expect(classifyProcessingState("PROCESSING")).toBe("processing");
    expect(classifyProcessingState("SOMETHING_ELSE")).toBe("processing");
    expect(classifyProcessingState(null)).toBe("processing");
  });
});

describe(findBuildByVersion, () => {
  it.effect("returns the newest build ASC lists for the version", () =>
    Effect.gen(function* () {
      const ctx = buildTokenRequestContext(CREDS);
      mocks.buildGetAsync.mockResolvedValue([makeBuild("b2", "VALID"), makeBuild("b1", "VALID")]);
      const build = yield* findBuildByVersion(ctx, "app-1", "42");
      expect(build?.id).toBe("b2");
    }),
  );
  it.effect("returns null when no build matches the version", () =>
    Effect.gen(function* () {
      const ctx = buildTokenRequestContext(CREDS);
      mocks.buildGetAsync.mockResolvedValue([]);
      const build = yield* findBuildByVersion(ctx, "app-1", "99");
      expect(build).toBeNull();
    }),
  );
});

describe(matchBetaGroupsByName, () => {
  it("matches every requested group by exact name", () => {
    const groups = [
      { id: "g1", name: "Internal" },
      { id: "g2", name: "QA" },
    ];
    const { matched, missing } = matchBetaGroupsByName(groups, ["Internal", "QA"]);
    expect(matched.map((grp) => grp.id)).toStrictEqual(["g1", "g2"]);
    expect(missing).toStrictEqual([]);
  });
  it("reports names with no matching group, case-sensitively", () => {
    const groups = [{ id: "g1", name: "Internal" }];
    const { matched, missing } = matchBetaGroupsByName(groups, ["internal", "Ghost"]);
    expect(matched).toStrictEqual([]);
    expect(missing).toStrictEqual(["internal", "Ghost"]);
  });
});

describe(needsTestFlightConfig, () => {
  it("is true when whatToTest or groups are present, false otherwise", () => {
    expect(needsTestFlightConfig({ whatToTest: "x", groups: [] })).toBe(true);
    expect(needsTestFlightConfig({ whatToTest: undefined, groups: ["G"] })).toBe(true);
    expect(needsTestFlightConfig({ whatToTest: undefined, groups: [] })).toBe(false);
  });
});

// ── resolveTestFlightAppId ──────────────────────────────────────

describe(resolveTestFlightAppId, () => {
  it.effect("uses an explicit ascAppId without looking the app up", () =>
    Effect.gen(function* () {
      const appId = yield* resolveTestFlightAppId({
        credentials: CREDS,
        ascAppId: "6700000001",
        bundleIdentifier: "com.acme.app",
      });
      expect(appId).toBe("6700000001");
      expect(mocks.appFindAsync).not.toHaveBeenCalled();
    }),
  );

  it.effect("resolves the app by bundle id via a JWT built from the decrypted .p8", () =>
    Effect.gen(function* () {
      mocks.appFindAsync.mockResolvedValue({ id: "app-1" });
      const appId = yield* resolveTestFlightAppId({
        credentials: CREDS,
        ascAppId: undefined,
        bundleIdentifier: "com.acme.app",
      });
      expect(appId).toBe("app-1");
      expect(mocks.tokenCtor).toHaveBeenCalledWith({
        key: "PEM",
        keyId: "K1",
        issuerId: "ISS-UUID",
      });
    }),
  );

  it.effect("fails TESTFLIGHT_APP_NOT_FOUND when no app exists for the bundle id", () =>
    Effect.gen(function* () {
      mocks.appFindAsync.mockResolvedValue(null);
      const error = yield* Effect.flip(
        resolveTestFlightAppId({
          credentials: CREDS,
          ascAppId: undefined,
          bundleIdentifier: "com.acme.ghost",
        }),
      );
      expect(error.code).toBe("TESTFLIGHT_APP_NOT_FOUND");
    }),
  );
});

// ── applyTestFlightConfig ───────────────────────────────────────

describe(applyTestFlightConfig, () => {
  it.effect("sets what-to-test and assigns matched beta groups on the valid build", () =>
    Effect.gen(function* () {
      const build = makeBuild("b1", "VALID");
      mocks.buildGetAsync.mockResolvedValue([build]);
      mocks.betaLocCreateAsync.mockResolvedValue({
        updateAsync: vi.fn<() => Promise<void>>(async () => undefined),
      });
      mocks.betaGroupGetAsync.mockResolvedValue([group("g1", "Internal")]);

      const result = yield* applyTestFlightConfig({
        credentials: CREDS,
        appId: "app-1",
        buildVersion: "42",
        language: "en-US",
        whatToTest: "Rockxy first build",
        groups: ["Internal"],
        pollIntervalMs: 0,
        pollTimeoutMs: 10_000,
      });

      expect(result).toStrictEqual({ buildId: "b1", buildVersion: "42" });
      expect(mocks.betaLocCreateAsync).toHaveBeenCalledWith(expect.anything(), {
        id: "b1",
        locale: "en-US",
      });
      expect(build.addBetaGroupsAsync).toHaveBeenCalledWith({ betaGroups: ["g1"] });
    }).pipe(withOutput),
  );

  it.effect("fails TESTFLIGHT_GROUP_NOT_FOUND for an unknown group name", () =>
    Effect.gen(function* () {
      mocks.buildGetAsync.mockResolvedValue([makeBuild("b1", "VALID")]);
      mocks.betaGroupGetAsync.mockResolvedValue([group("g1", "Internal")]);
      const error = yield* Effect.flip(
        applyTestFlightConfig({
          credentials: CREDS,
          appId: "app-1",
          buildVersion: "42",
          language: undefined,
          whatToTest: undefined,
          groups: ["Ghost"],
          pollIntervalMs: 0,
          pollTimeoutMs: 10_000,
        }),
      );
      expect(error.code).toBe("TESTFLIGHT_GROUP_NOT_FOUND");
    }).pipe(withOutput),
  );

  it.effect("fails TESTFLIGHT_BUILD_PROCESSING_FAILED when the build is rejected", () =>
    Effect.gen(function* () {
      mocks.buildGetAsync.mockResolvedValue([makeBuild("b1", "FAILED")]);
      const error = yield* Effect.flip(
        applyTestFlightConfig({
          credentials: CREDS,
          appId: "app-1",
          buildVersion: "42",
          language: undefined,
          whatToTest: "x",
          groups: [],
          pollIntervalMs: 0,
          pollTimeoutMs: 10_000,
        }),
      );
      expect(error.code).toBe("TESTFLIGHT_BUILD_PROCESSING_FAILED");
    }).pipe(withOutput),
  );
});
