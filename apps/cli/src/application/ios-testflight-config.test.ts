import { it } from "@effect/vitest";
import { Effect } from "effect";

// eslint-disable-next-line import-plugin/no-namespace -- vi.mock factory return must satisfy the full module namespace type
import type * as AppleUtilsModule from "@expo/apple-utils";

import { makeOutputModeLayer } from "../lib/output-mode";
import {
  applyTestFlightConfig,
  captureTestFlightContext,
  classifyProcessingState,
  matchBetaGroupsByName,
  needsTestFlightConfig,
  pickNewBuild,
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

describe(pickNewBuild, () => {
  it("returns null when there are no builds", () => {
    expect(pickNewBuild([], null)).toBeNull();
    expect(pickNewBuild([], "b1")).toBeNull();
  });
  it("returns null when the newest build is the pre-upload baseline", () => {
    expect(pickNewBuild([{ id: "b1" }], "b1")).toBeNull();
  });
  it("returns the newest build when it differs from the baseline", () => {
    expect(pickNewBuild([{ id: "b2" }, { id: "b1" }], "b1")?.id).toBe("b2");
  });
  it("returns the newest build when there was no baseline", () => {
    expect(pickNewBuild([{ id: "b1" }], null)?.id).toBe("b1");
  });
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

// ── captureTestFlightContext ────────────────────────────────────

describe(captureTestFlightContext, () => {
  it.effect("uses an explicit ascAppId without looking the app up", () =>
    Effect.gen(function* () {
      mocks.buildGetAsync.mockResolvedValue([]);
      const ctx = yield* captureTestFlightContext({
        credentials: CREDS,
        ascAppId: "6700000001",
        bundleIdentifier: "com.acme.app",
      });
      expect(ctx).toStrictEqual({ appId: "6700000001", baselineLatestBuildId: null });
      expect(mocks.appFindAsync).not.toHaveBeenCalled();
      // the JWT Token is built from the decrypted .p8
      expect(mocks.tokenCtor).toHaveBeenCalledWith({
        key: "PEM",
        keyId: "K1",
        issuerId: "ISS-UUID",
      });
    }),
  );

  it.effect("resolves the app by bundle id and snapshots the latest build", () =>
    Effect.gen(function* () {
      mocks.appFindAsync.mockResolvedValue({ id: "app-1" });
      mocks.buildGetAsync.mockResolvedValue([makeBuild("b9", "VALID")]);
      const ctx = yield* captureTestFlightContext({
        credentials: CREDS,
        ascAppId: undefined,
        bundleIdentifier: "com.acme.app",
      });
      expect(ctx).toStrictEqual({ appId: "app-1", baselineLatestBuildId: "b9" });
    }),
  );

  it.effect("fails TESTFLIGHT_APP_NOT_FOUND when no app exists for the bundle id", () =>
    Effect.gen(function* () {
      mocks.appFindAsync.mockResolvedValue(null);
      const error = yield* Effect.flip(
        captureTestFlightContext({
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

const CONTEXT = { appId: "app-1", baselineLatestBuildId: "b0" } as const;

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
        context: CONTEXT,
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
          context: CONTEXT,
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
          context: CONTEXT,
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
