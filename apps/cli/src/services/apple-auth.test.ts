import { it } from "@effect/vitest";
import { Effect, Exit, Layer } from "effect";

import type { Auth, Session } from "@expo/apple-utils";

import { InteractiveProhibitedError } from "../lib/exit-codes";
import { InteractiveModeLive, makeInteractiveModeLayer } from "../lib/interactive-mode";
import { AppleAuth, makeAppleAuthLive } from "./apple-auth";
import { AppleSessionStore } from "./apple-session-store";
import { CliRuntime } from "./cli-runtime";

import type { AppleAuthError } from "../lib/exit-codes";
import type { AppleUtilsContract } from "./apple-auth";
import type { SerializedAppleSession } from "./apple-session-store";

const cliRuntimeStub = (env: Readonly<Record<string, string | undefined>> = {}) =>
  Layer.succeed(CliRuntime, {
    argv: [],
    platform: "linux" as NodeJS.Platform,
    cwd: Effect.succeed("/"),
    getEnv: (name: string) => Effect.succeed(env[name]),
    homeDirectory: Effect.succeed("/"),
    userName: Effect.succeed("test"),
    commandEnvironment: () => Effect.succeed({}),
    setExitCode: () => Effect.void,
  });

// ── helpers ──────────────────────────────────────────────────────

const COOKIES_FIXTURE = { cookies: [] } as unknown as NonNullable<Auth.UserCredentials["cookies"]>;

const makeProvider = (
  providerId: number,
  teamId = `TEAM${providerId}`,
  name = `Provider ${providerId}`,
): Session.SessionProvider => ({
  providerId,
  publicProviderId: teamId,
  name,
  contentTypes: ["SOFTWARE"],
  subType: "ORGANIZATION",
});

const makeAuthState = (
  overrides: Partial<{
    username: string;
    teamId: string;
    providerName: string;
    providerId: number;
    availableProviders: readonly Session.SessionProvider[];
  }> = {},
): Session.AuthState => {
  const username = overrides.username ?? "cong@example.com";
  const teamId = overrides.teamId ?? "TEAM1234";
  const providerId = overrides.providerId ?? 100;
  const providerName = overrides.providerName ?? "BC Org";
  const provider = makeProvider(providerId, teamId, providerName);
  return {
    username,
    cookies: COOKIES_FIXTURE,
    context: { providerId, teamId },
    session: {
      provider,
      availableProviders: overrides.availableProviders ?? [provider],
    },
  } as Session.AuthState;
};

interface SessionStoreState {
  session: SerializedAppleSession | null;
  lastUsername: string | null;
  saveCalls: SerializedAppleSession[];
  clearCalls: number;
  usernameSaves: string[];
}

const makeSessionStoreLayer = (initial: Partial<SessionStoreState> = {}) => {
  const state: SessionStoreState = {
    session: initial.session ?? null,
    lastUsername: initial.lastUsername ?? null,
    saveCalls: [],
    clearCalls: 0,
    usernameSaves: [],
  };
  const layer = Layer.succeed(AppleSessionStore, {
    loadSession: Effect.sync(() => state.session),
    saveSession: (session) =>
      Effect.sync(() => {
        state.saveCalls.push(session);
        state.session = session;
      }),
    clearSession: Effect.sync(() => {
      state.clearCalls += 1;
      state.session = null;
    }),
    loadLastUsername: Effect.sync(() => state.lastUsername),
    saveLastUsername: (username) =>
      Effect.sync(() => {
        state.usernameSaves.push(username);
        state.lastUsername = username;
      }),
  });
  return { layer, state };
};

const makeAppleUtilsStub = (
  overrides: Partial<{
    loginWithCookies: (input: unknown) => Promise<Session.AuthState | null>;
    loginWithUserCredentials: (input: unknown) => Promise<Session.AuthState | null>;
    logout: () => Promise<void>;
    getAnySessionInfo: () => Session.SessionInfo | null;
    setSessionProviderId: (id: number) => Promise<Session.SessionInfo | null>;
    getCookiesJSON: () => NonNullable<Auth.UserCredentials["cookies"]>;
  }> = {},
): AppleUtilsContract => ({
  Auth: {
    loginWithCookiesAsync: (overrides.loginWithCookies ??
      (async () => null)) as AppleUtilsContract["Auth"]["loginWithCookiesAsync"],
    loginWithUserCredentialsAsync: (overrides.loginWithUserCredentials ??
      (async () => null)) as AppleUtilsContract["Auth"]["loginWithUserCredentialsAsync"],
    logoutAsync: overrides.logout ?? (async () => {}),
  },
  Session: {
    getAnySessionInfo: overrides.getAnySessionInfo ?? (() => null),
    setSessionProviderIdAsync: overrides.setSessionProviderId ?? (async () => null),
  },
  CookieFileCache: {
    getCookiesJSON: overrides.getCookiesJSON ?? (() => COOKIES_FIXTURE),
  },
});

// ── tests ───────────────────────────────────────────────────────

describe("AppleAuth.ensureLoggedIn", () => {
  it.effect("restores cached single-team session without prompting", () =>
    Effect.gen(function* () {
      const auth = yield* AppleAuth;
      const session = yield* auth.ensureLoggedIn();
      expect(session.username).toBe("cong@example.com");
      expect(session.teamId).toBe("TEAM1234");
      expect(session.providerId).toBe(100);
    }).pipe(
      Effect.provide(
        (() => {
          const { layer } = makeSessionStoreLayer({
            session: {
              cookies: COOKIES_FIXTURE,
              username: "cong@example.com",
            },
          });
          const appleUtils = makeAppleUtilsStub({
            loginWithCookies: async () => makeAuthState(),
          });
          return Layer.mergeAll(
            makeAppleAuthLive(appleUtils).pipe(Layer.provide(layer)),
            layer,
            InteractiveModeLive,
            cliRuntimeStub(),
          );
        })(),
      ),
    ),
  );

  it.effect("multi-team non-interactive switches to APPLE_PROVIDER_ID env override", () =>
    Effect.gen(function* () {
      const auth = yield* AppleAuth;
      const session = yield* auth.ensureLoggedIn();
      expect(session.providerId).toBe(200);
      expect(session.teamId).toBe("TEAM200");
    }).pipe(
      Effect.provide(
        (() => {
          const { layer } = makeSessionStoreLayer({
            session: {
              cookies: COOKIES_FIXTURE,
              username: "cong@example.com",
            },
          });
          const appleUtils = makeAppleUtilsStub({
            loginWithCookies: async () =>
              makeAuthState({
                providerId: 100,
                teamId: "TEAM100",
                availableProviders: [makeProvider(100, "TEAM100"), makeProvider(200, "TEAM200")],
              }),
          });
          return Layer.mergeAll(
            makeAppleAuthLive(appleUtils).pipe(Layer.provide(layer)),
            layer,
            makeInteractiveModeLayer(false),
            cliRuntimeStub({ APPLE_PROVIDER_ID: "200" }),
          );
        })(),
      ),
    ),
  );

  it.effect(
    "multi-team non-interactive without env preserves the apple-utils auto-resolved current",
    () =>
      Effect.gen(function* () {
        const auth = yield* AppleAuth;
        const session = yield* auth.ensureLoggedIn();
        expect(session.providerId).toBe(100);
        expect(session.teamId).toBe("TEAM100");
      }).pipe(
        Effect.provide(
          (() => {
            const { layer } = makeSessionStoreLayer({
              session: {
                cookies: COOKIES_FIXTURE,
                username: "cong@example.com",
              },
            });
            const appleUtils = makeAppleUtilsStub({
              loginWithCookies: async () =>
                makeAuthState({
                  providerId: 100,
                  teamId: "TEAM100",
                  availableProviders: [makeProvider(100, "TEAM100"), makeProvider(200, "TEAM200")],
                }),
            });
            return Layer.mergeAll(
              makeAppleAuthLive(appleUtils).pipe(Layer.provide(layer)),
              layer,
              makeInteractiveModeLayer(false),
              cliRuntimeStub(),
            );
          })(),
        ),
      ),
  );

  it.effect("fails when interactive disabled and no cached session", () =>
    Effect.gen(function* () {
      const auth = yield* AppleAuth;
      const exit = yield* Effect.exit(auth.ensureLoggedIn());
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const err = exit.cause._tag === "Fail" ? exit.cause.error : null;
        expect(err).toBeInstanceOf(InteractiveProhibitedError);
      }
    }).pipe(
      Effect.provide(
        (() => {
          const { layer } = makeSessionStoreLayer();
          const appleUtils = makeAppleUtilsStub();
          return Layer.mergeAll(
            makeAppleAuthLive(appleUtils).pipe(Layer.provide(layer)),
            layer,
            makeInteractiveModeLayer(false),
            cliRuntimeStub(),
          );
        })(),
      ),
    ),
  );

  it.effect("falls through to interactive login when cookie restore throws", () =>
    Effect.gen(function* () {
      const auth = yield* AppleAuth;
      const exit = yield* Effect.exit(auth.ensureLoggedIn());
      // Restore failure (swallowed) → falls through to interactive prompt; with
      // interactive off, that becomes InteractiveProhibitedError.
      expect(Exit.isFailure(exit)).toBe(true);
    }).pipe(
      Effect.provide(
        (() => {
          const { layer } = makeSessionStoreLayer({
            session: {
              cookies: COOKIES_FIXTURE,
              username: "cong@example.com",
            },
          });
          const appleUtils = makeAppleUtilsStub({
            loginWithCookies: async () => {
              throw new Error("cookies expired");
            },
          });
          return Layer.mergeAll(
            makeAppleAuthLive(appleUtils).pipe(Layer.provide(layer)),
            layer,
            makeInteractiveModeLayer(false),
            cliRuntimeStub(),
          );
        })(),
      ),
    ),
  );
});

describe("AppleAuth.whoami", () => {
  it.effect("returns null when no session is cached", () =>
    Effect.gen(function* () {
      const auth = yield* AppleAuth;
      const session = yield* auth.whoami;
      expect(session).toBeNull();
    }).pipe(
      Effect.provide(
        (() => {
          const { layer } = makeSessionStoreLayer();
          return Layer.mergeAll(
            makeAppleAuthLive(makeAppleUtilsStub()).pipe(Layer.provide(layer)),
            layer,
            InteractiveModeLive,
          );
        })(),
      ),
    ),
  );

  it.effect("returns null when cookies expired and apple-utils has no in-memory session", () =>
    Effect.gen(function* () {
      const auth = yield* AppleAuth;
      const session = yield* auth.whoami;
      expect(session).toBeNull();
    }).pipe(
      Effect.provide(
        (() => {
          const { layer } = makeSessionStoreLayer({
            session: {
              cookies: COOKIES_FIXTURE,
              username: "cong@example.com",
            },
          });
          const appleUtils = makeAppleUtilsStub({
            loginWithCookies: async () => null,
            getAnySessionInfo: () => null,
          });
          return Layer.mergeAll(
            makeAppleAuthLive(appleUtils).pipe(Layer.provide(layer)),
            layer,
            InteractiveModeLive,
          );
        })(),
      ),
    ),
  );

  it.effect("falls back to apple-utils in-memory session info when cookie restore fails", () =>
    Effect.gen(function* () {
      const auth = yield* AppleAuth;
      const session = yield* auth.whoami;
      expect(session).not.toBeNull();
      expect(session?.username).toBe("cong@example.com");
      expect(session?.teamId).toBe("TEAM-MEM");
      expect(session?.teamName).toBe("Memory Org");
    }).pipe(
      Effect.provide(
        (() => {
          const { layer } = makeSessionStoreLayer({
            session: {
              cookies: COOKIES_FIXTURE,
              username: "cong@example.com",
            },
          });
          const appleUtils = makeAppleUtilsStub({
            loginWithCookies: async () => null,
            getAnySessionInfo: () =>
              ({
                provider: makeProvider(500, "TEAM-MEM", "Memory Org"),
              }) as unknown as Session.SessionInfo,
          });
          return Layer.mergeAll(
            makeAppleAuthLive(appleUtils).pipe(Layer.provide(layer)),
            layer,
            InteractiveModeLive,
          );
        })(),
      ),
    ),
  );
});

describe("AppleAuth.logout", () => {
  it.effect("clears the cached session and calls Apple logout", () => {
    const { layer, state } = makeSessionStoreLayer({
      session: {
        cookies: COOKIES_FIXTURE,
        username: "cong@example.com",
      },
    });
    const logoutCalls: number[] = [];
    const appleUtils = makeAppleUtilsStub({
      logout: async () => {
        logoutCalls.push(Date.now());
      },
    });
    return Effect.gen(function* () {
      const auth = yield* AppleAuth;
      yield* auth.logout;
      expect(state.clearCalls).toBe(1);
      expect(logoutCalls).toHaveLength(1);
      expect(state.session).toBeNull();
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          makeAppleAuthLive(appleUtils).pipe(Layer.provide(layer)),
          layer,
          InteractiveModeLive,
        ),
      ),
    );
  });
});

describe("AppleAuth.buildRequestContext", () => {
  it.effect("omits providerId when undefined", () =>
    Effect.gen(function* () {
      const auth = yield* AppleAuth;
      const ctx = auth.buildRequestContext({
        username: "x@example.com",
        teamId: "TEAM",
        teamName: null,
        providerId: undefined,
      });
      expect(ctx).toStrictEqual({ teamId: "TEAM" });
    }).pipe(
      Effect.provide(
        (() => {
          const { layer } = makeSessionStoreLayer();
          return Layer.mergeAll(
            makeAppleAuthLive(makeAppleUtilsStub()).pipe(Layer.provide(layer)),
            layer,
            InteractiveModeLive,
          );
        })(),
      ),
    ),
  );

  it.effect("includes providerId when defined", () =>
    Effect.gen(function* () {
      const auth = yield* AppleAuth;
      const ctx = auth.buildRequestContext({
        username: "x@example.com",
        teamId: "TEAM",
        teamName: null,
        providerId: 42,
      });
      expect(ctx).toStrictEqual({ teamId: "TEAM", providerId: 42 });
    }).pipe(
      Effect.provide(
        (() => {
          const { layer } = makeSessionStoreLayer();
          return Layer.mergeAll(
            makeAppleAuthLive(makeAppleUtilsStub()).pipe(Layer.provide(layer)),
            layer,
            InteractiveModeLive,
          );
        })(),
      ),
    ),
  );
});

// Helpers re-exported for `unused` guard — AppleAuthError import ensures
// The test file remains in sync with the public exit-codes surface.
export type _Guard = AppleAuthError;
