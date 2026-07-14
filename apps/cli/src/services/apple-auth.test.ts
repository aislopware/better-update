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
    platform: "linux",
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
  sessions: Map<string, SerializedAppleSession>;
  active: string | null;
  lastUsername: string | null;
  saveCalls: SerializedAppleSession[];
  clearCalls: number;
  clearAllCalls: number;
  activeSets: string[];
  usernameSaves: string[];
}

const normalize = (username: string) => username.trim().toLowerCase();

const makeSessionStoreLayer = (
  initial: Partial<{
    session: SerializedAppleSession | null;
    sessions: readonly SerializedAppleSession[];
    lastUsername: string | null;
  }> = {},
) => {
  const seeded = [...(initial.session ? [initial.session] : []), ...(initial.sessions ?? [])];
  const state: SessionStoreState = {
    sessions: new Map(seeded.map((session) => [normalize(session.username), session])),
    active: seeded[0] === undefined ? null : normalize(seeded[0].username),
    lastUsername: initial.lastUsername ?? null,
    saveCalls: [],
    clearCalls: 0,
    clearAllCalls: 0,
    activeSets: [],
    usernameSaves: [],
  };
  const layer = Layer.succeed(AppleSessionStore, {
    loadSession: Effect.sync(() =>
      state.active === null ? null : (state.sessions.get(state.active) ?? null),
    ),
    loadSessionFor: (username) =>
      Effect.sync(() => state.sessions.get(normalize(username)) ?? null),
    saveSession: (session) =>
      Effect.sync(() => {
        state.saveCalls.push(session);
        state.sessions.set(normalize(session.username), session);
        state.active = normalize(session.username);
      }),
    clearSession: Effect.sync(() => {
      state.clearCalls += 1;
      if (state.active !== null) {
        state.sessions.delete(state.active);
      }
      state.active = null;
    }),
    clearAllSessions: Effect.sync(() => {
      state.clearAllCalls += 1;
      state.sessions.clear();
      state.active = null;
    }),
    listAccounts: Effect.sync(() => ({
      active: state.active,
      accounts: [...state.sessions.keys()],
    })),
    setActiveAccount: (username) =>
      Effect.sync(() => {
        state.activeSets.push(normalize(username));
        state.active = normalize(username);
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
    getTeams: () => Promise<unknown>;
    getCookiesJSON: () => NonNullable<Auth.UserCredentials["cookies"]>;
  }> = {},
): AppleUtilsContract => ({
  Auth: {
    loginWithCookiesAsync: overrides.loginWithCookies ?? (async () => null),
    loginWithUserCredentialsAsync: overrides.loginWithUserCredentials ?? (async () => null),
    logoutAsync: overrides.logout ?? (async () => {}),
  },
  Session: {
    getAnySessionInfo: overrides.getAnySessionInfo ?? (() => null),
    setSessionProviderIdAsync: overrides.setSessionProviderId ?? (async () => null),
  },
  Teams: {
    getTeamsAsync: (overrides.getTeams ??
      (async () => [])) as AppleUtilsContract["Teams"]["getTeamsAsync"],
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
    "switching to a UUID-provider team resolves the 10-char Team ID from the portal team list",
    () =>
      Effect.gen(function* () {
        const auth = yield* AppleAuth;
        const session = yield* auth.ensureLoggedIn();
        // publicProviderId is a UUID, so the real 10-char Team ID must come from getTeamsAsync.
        expect(session.providerId).toBe(200);
        expect(session.teamId).toBe("LPZ7MF9QXQ");
      }).pipe(
        Effect.provide(
          (() => {
            const { layer } = makeSessionStoreLayer({
              session: { cookies: COOKIES_FIXTURE, username: "cong@example.com" },
            });
            const uuidProvider = makeProvider(
              200,
              "69a6de80-b33d-47e3-e053-5b8c7c11a4d1",
              "JMango Operations B.V.",
            );
            const appleUtils = makeAppleUtilsStub({
              loginWithCookies: async () =>
                makeAuthState({
                  providerId: 100,
                  teamId: "TEAM100",
                  availableProviders: [makeProvider(100, "TEAM100"), uuidProvider],
                }),
              getTeams: async () => [
                { teamId: "LPZ7MF9QXQ", name: "JMango Operations B.V." },
                { teamId: "OTHER12345", name: "Someone Else" },
              ],
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

  it.effect("username option restores that account's cached session and activates it", () => {
    const sessionA: SerializedAppleSession = {
      cookies: COOKIES_FIXTURE,
      username: "a@example.com",
    };
    const sessionB: SerializedAppleSession = {
      cookies: COOKIES_FIXTURE,
      username: "b@example.com",
    };
    const { layer, state } = makeSessionStoreLayer({ sessions: [sessionA, sessionB] });
    const restoredFor: string[] = [];
    const appleUtils = makeAppleUtilsStub({
      loginWithCookies: async () => {
        restoredFor.push("call");
        return makeAuthState({ username: "b@example.com" });
      },
    });
    return Effect.gen(function* () {
      const auth = yield* AppleAuth;
      // Active account is a@example.com; explicitly target the other one.
      const session = yield* auth.ensureLoggedIn({ username: "B@Example.com" });
      expect(session.username).toBe("b@example.com");
      expect(restoredFor).toHaveLength(1);
      expect(state.activeSets).toStrictEqual(["b@example.com"]);
      expect(state.active).toBe("b@example.com");
      // No fresh credentials login happened — nothing re-saved.
      expect(state.saveCalls).toHaveLength(0);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          makeAppleAuthLive(appleUtils).pipe(Layer.provide(layer)),
          layer,
          InteractiveModeLive,
          cliRuntimeStub(),
        ),
      ),
    );
  });

  it.effect("freshLogin skips the cached session and goes straight to interactive login", () => {
    const { layer } = makeSessionStoreLayer({
      session: { cookies: COOKIES_FIXTURE, username: "cong@example.com" },
    });
    const restoreCalls: string[] = [];
    const appleUtils = makeAppleUtilsStub({
      loginWithCookies: async () => {
        restoreCalls.push("call");
        return makeAuthState();
      },
    });
    return Effect.gen(function* () {
      const auth = yield* AppleAuth;
      const exit = yield* Effect.exit(auth.ensureLoggedIn({ freshLogin: true }));
      // Interactive is disabled, so a forced fresh login must fail — proving the
      // valid cached session was never consulted.
      expect(Exit.isFailure(exit)).toBe(true);
      expect(restoreCalls).toHaveLength(0);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          makeAppleAuthLive(appleUtils).pipe(Layer.provide(layer)),
          layer,
          makeInteractiveModeLayer(false),
          cliRuntimeStub(),
        ),
      ),
    );
  });

  it.effect("username option without a cached session falls through to interactive login", () => {
    const { layer } = makeSessionStoreLayer({
      session: { cookies: COOKIES_FIXTURE, username: "a@example.com" },
    });
    const appleUtils = makeAppleUtilsStub({
      loginWithCookies: async () => makeAuthState({ username: "a@example.com" }),
    });
    return Effect.gen(function* () {
      const auth = yield* AppleAuth;
      const exit = yield* Effect.exit(auth.ensureLoggedIn({ username: "new@example.com" }));
      // The active account must NOT be silently returned for a different target.
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const err = exit.cause._tag === "Fail" ? exit.cause.error : null;
        expect(err).toBeInstanceOf(InteractiveProhibitedError);
      }
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          makeAppleAuthLive(appleUtils).pipe(Layer.provide(layer)),
          layer,
          makeInteractiveModeLayer(false),
          cliRuntimeStub(),
        ),
      ),
    );
  });

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
      expect(state.active).toBeNull();
      expect(state.sessions.size).toBe(0);
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

describe("AppleAuth.logoutAll", () => {
  it.effect("clears every cached account and calls Apple logout", () => {
    const { layer, state } = makeSessionStoreLayer({
      sessions: [
        { cookies: COOKIES_FIXTURE, username: "a@example.com" },
        { cookies: COOKIES_FIXTURE, username: "b@example.com" },
      ],
    });
    const logoutCalls: string[] = [];
    const appleUtils = makeAppleUtilsStub({
      logout: async () => {
        logoutCalls.push("call");
      },
    });
    return Effect.gen(function* () {
      const auth = yield* AppleAuth;
      yield* auth.logoutAll;
      expect(state.clearAllCalls).toBe(1);
      expect(state.sessions.size).toBe(0);
      expect(state.active).toBeNull();
      expect(logoutCalls).toHaveLength(1);
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
