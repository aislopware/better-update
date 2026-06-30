import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";

// eslint-disable-next-line import-plugin/no-namespace -- vi.mock factory return must satisfy the full module namespace type
import type * as AppleUtilsModule from "@expo/apple-utils";

import { makeInteractiveModeLayer } from "../lib/interactive-mode";
import { makeOutputModeLayer } from "../lib/output-mode";
import { AppleAuth } from "../services/apple-auth";
import { ensureAscAppForSubmit } from "./submit-asc-app";

import type { AscCredentials } from "../lib/asc-credentials";
// eslint-disable-next-line import-plugin/no-namespace -- vi.mock factory return must satisfy the full module namespace type
import type * as EasJsonModule from "../lib/eas-json";
import type { InteractiveMode } from "../lib/interactive-mode";
import type { OutputMode } from "../lib/output-mode";
// eslint-disable-next-line import-plugin/no-namespace -- vi.mock factory return must satisfy the full module namespace type
import type * as PromptsModule from "../lib/prompts";

// ── module mocks ────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  tokenCtor: vi.fn<(opts: unknown) => void>(),
  appFindAsync: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  appCreateAsync: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  promptConfirm: vi.fn<(...args: unknown[]) => unknown>(),
  promptText: vi.fn<(...args: unknown[]) => unknown>(),
  setSubmit: vi.fn<(...args: unknown[]) => unknown>(),
  ensureLoggedIn: vi.fn<(...args: unknown[]) => unknown>(),
}));

vi.mock(import("@expo/apple-utils"), () => {
  // `new Token(opts)` records its args in tokenCtor.mock.calls (vi.fn is newable).
  const mocked = {
    Token: mocks.tokenCtor,
    Platform: { IOS: "IOS" },
    App: { findAsync: mocks.appFindAsync, createAsync: mocks.appCreateAsync },
  };
  return { ...mocked, default: mocked } as unknown as typeof AppleUtilsModule;
});

vi.mock(
  import("../lib/prompts"),
  () =>
    ({
      promptConfirm: (...args: unknown[]) => mocks.promptConfirm(...args),
      promptText: (...args: unknown[]) => mocks.promptText(...args),
    }) as unknown as typeof PromptsModule,
);

vi.mock(
  import("../lib/eas-json"),
  () =>
    ({
      setSubmitProfileAscAppId: (...args: unknown[]) => mocks.setSubmit(...args),
    }) as unknown as typeof EasJsonModule,
);

// ── harness ─────────────────────────────────────────────────────

const appleAuthStub = Layer.succeed(AppleAuth, {
  ensureLoggedIn: (...args: unknown[]) => mocks.ensureLoggedIn(...args),
  buildRequestContext: () => ({ teamId: "TEAM1234", providerId: 1 }),
  logout: Effect.void,
  whoami: Effect.succeed(null),
} as unknown as typeof AppleAuth.Service);

const CREDS: AscCredentials = { keyId: "K1", issuerId: "ISS-UUID", p8Pem: "PEM" };

const run = (interactive: boolean, overrides: Partial<{ appName: string }> = {}) =>
  (
    ensureAscAppForSubmit({
      credentials: CREDS,
      projectRoot: "/proj",
      profileName: "production",
      bundleIdentifier: "com.acme.app",
      appName: overrides.appName,
      sku: undefined,
      companyName: undefined,
      primaryLocale: undefined,
    }) as Effect.Effect<string | null, never, AppleAuth | InteractiveMode | OutputMode>
  ).pipe(
    Effect.provide(
      Layer.mergeAll(
        appleAuthStub,
        makeInteractiveModeLayer(interactive),
        makeOutputModeLayer(false),
      ),
    ),
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.setSubmit.mockReturnValue(Effect.succeed("/proj/eas.json"));
  mocks.ensureLoggedIn.mockReturnValue(
    Effect.succeed({ username: "u@acme.com", teamId: "TEAM1234", teamName: "Acme", providerId: 1 }),
  );
});

// ── tests ───────────────────────────────────────────────────────

describe(ensureAscAppForSubmit, () => {
  it.effect("returns the existing app id headlessly, persisting without an Apple login", () =>
    Effect.gen(function* () {
      mocks.appFindAsync.mockResolvedValue({ id: "6700000001" });

      const result = yield* run(true);

      expect(result).toBe("6700000001");
      expect(mocks.setSubmit).toHaveBeenCalledWith("/proj", "production", "6700000001");
      expect(mocks.ensureLoggedIn).not.toHaveBeenCalled();
      expect(mocks.appCreateAsync).not.toHaveBeenCalled();
      expect(mocks.tokenCtor).toHaveBeenCalledWith({
        key: "PEM",
        keyId: "K1",
        issuerId: "ISS-UUID",
      });
    }),
  );

  it.effect("returns null without prompting or logging in when non-interactive and missing", () =>
    Effect.gen(function* () {
      mocks.appFindAsync.mockResolvedValue(null);

      const result = yield* run(false);

      expect(result).toBeNull();
      expect(mocks.promptConfirm).not.toHaveBeenCalled();
      expect(mocks.ensureLoggedIn).not.toHaveBeenCalled();
    }),
  );

  it.effect("creates the app from the Apple ID session when confirmed", () =>
    Effect.gen(function* () {
      mocks.appFindAsync.mockResolvedValue(null);
      mocks.promptConfirm.mockReturnValue(Effect.succeed(true));
      mocks.appCreateAsync.mockResolvedValue({ id: "6700000002" });

      const result = yield* run(true, { appName: "Rockxy" });

      expect(result).toBe("6700000002");
      expect(mocks.ensureLoggedIn).toHaveBeenCalledTimes(1);
      const [, createProps] = mocks.appCreateAsync.mock.calls[0] as [
        unknown,
        { name: string; bundleId: string; sku: string; platforms: string[] },
      ];
      expect(createProps).toMatchObject({
        name: "Rockxy",
        bundleId: "com.acme.app",
        sku: "com.acme.app",
        platforms: ["IOS"],
      });
      expect(mocks.setSubmit).toHaveBeenCalledWith("/proj", "production", "6700000002");
    }),
  );

  it.effect("returns null when the user declines to create", () =>
    Effect.gen(function* () {
      mocks.appFindAsync.mockResolvedValue(null);
      mocks.promptConfirm.mockReturnValue(Effect.succeed(false));

      const result = yield* run(true, { appName: "Rockxy" });

      expect(result).toBeNull();
      expect(mocks.appCreateAsync).not.toHaveBeenCalled();
    }),
  );

  it.effect("degrades to null (queued) when App.createAsync rejects", () =>
    Effect.gen(function* () {
      mocks.appFindAsync.mockResolvedValue(null);
      mocks.promptConfirm.mockReturnValue(Effect.succeed(true));
      mocks.appCreateAsync.mockRejectedValue(
        new Error("APP_CREATE_BUNDLE_ID_NOT_REGISTERED: bundle id not registered"),
      );

      const result = yield* run(true, { appName: "Rockxy" });

      expect(result).toBeNull();
    }),
  );
});
