import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

// eslint-disable-next-line import-plugin/no-namespace -- vi.mock factory return must satisfy the full module namespace type
import type * as AppleUtilsModule from "@expo/apple-utils";
import type { RequestContext } from "@expo/apple-utils";

import { resolveBuild } from "./app-store-versions";

const mocks = vi.hoisted(() => ({
  buildGetAsync: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(),
  buildInfoAsync: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock(import("@expo/apple-utils"), () => {
  const mocked = {
    Build: { getAsync: mocks.buildGetAsync, infoAsync: mocks.buildInfoAsync },
  };
  return { ...mocked, default: mocked } as unknown as typeof AppleUtilsModule;
});

const ctx = {} as RequestContext;

beforeEach(() => {
  mocks.buildGetAsync.mockReset();
  mocks.buildInfoAsync.mockReset();
});

describe(resolveBuild, () => {
  it.effect("prefers an explicit build id over version/latest", () =>
    Effect.gen(function* () {
      mocks.buildInfoAsync.mockResolvedValue({ id: "explicit" });
      const build = yield* resolveBuild(ctx, "app-1", {
        buildId: "explicit",
        buildVersion: "42",
        latest: true,
      });
      expect(build).toStrictEqual({ id: "explicit" });
      expect(mocks.buildInfoAsync).toHaveBeenCalledWith(ctx, { id: "explicit" });
      expect(mocks.buildGetAsync).not.toHaveBeenCalled();
    }),
  );

  it.effect("resolves by CFBundleVersion when no id is given", () =>
    Effect.gen(function* () {
      mocks.buildGetAsync.mockResolvedValue([{ id: "b42" }]);
      const build = yield* resolveBuild(ctx, "app-1", {
        buildId: undefined,
        buildVersion: "42",
        latest: true,
      });
      expect(build).toStrictEqual({ id: "b42" });
      expect(mocks.buildGetAsync).toHaveBeenCalledWith(ctx, {
        query: { filter: { app: "app-1", version: "42" }, limit: 1 },
      });
    }),
  );

  it.effect("resolves the newest upload when only --latest is given", () =>
    Effect.gen(function* () {
      mocks.buildGetAsync.mockResolvedValue([{ id: "newest" }]);
      const build = yield* resolveBuild(ctx, "app-1", {
        buildId: undefined,
        buildVersion: undefined,
        latest: true,
      });
      expect(build).toStrictEqual({ id: "newest" });
      expect(mocks.buildGetAsync).toHaveBeenCalledWith(ctx, {
        query: { filter: { app: "app-1" }, sort: "-uploadedDate", limit: 1 },
      });
    }),
  );

  it.effect("fails with guidance when no selector is given", () =>
    Effect.gen(function* () {
      const exit = yield* resolveBuild(ctx, "app-1", {
        buildId: undefined,
        buildVersion: undefined,
        latest: false,
      }).pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  it.effect("fails when --latest finds no builds", () =>
    Effect.gen(function* () {
      mocks.buildGetAsync.mockResolvedValue([]);
      const exit = yield* resolveBuild(ctx, "app-1", {
        buildId: undefined,
        buildVersion: undefined,
        latest: true,
      }).pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );
});
