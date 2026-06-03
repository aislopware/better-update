import { compact } from "@better-update/type-guards";
// @expo/apple-utils is ncc-bundled CJS; `import * as` only surfaces `default`/`module.exports`
// via Node ESM's cjs-module-lexer, so Auth/Session/CookieFileCache are read off the default import.
import AppleUtils from "@expo/apple-utils";
import { Context, Effect, Layer } from "effect";

import type { Auth, RequestContext, Session } from "@expo/apple-utils";

import { resolveProvider } from "../lib/apple-auth";
import { AppleAuthError, InteractiveProhibitedError } from "../lib/exit-codes";
import { formatCause } from "../lib/format-error";
import { InteractiveMode } from "../lib/interactive-mode";
import { promptPassword, promptText } from "../lib/prompts";
import { AppleSessionStore } from "./apple-session-store";

import type { AppleSessionCookies } from "./apple-session-store";
import type { CliRuntime } from "./cli-runtime";

/**
 * Surface of `@expo/apple-utils` consumed by {@link AppleAuthLive}. Captured as
 * an interface so tests can supply a stub via {@link makeAppleAuthLive} without
 * relying on Vitest module mocks.
 */
export interface AppleUtilsContract {
  readonly Auth: {
    readonly loginWithCookiesAsync: typeof AppleUtils.Auth.loginWithCookiesAsync;
    readonly loginWithUserCredentialsAsync: typeof AppleUtils.Auth.loginWithUserCredentialsAsync;
    readonly logoutAsync: typeof AppleUtils.Auth.logoutAsync;
  };
  readonly Session: {
    readonly getAnySessionInfo: typeof AppleUtils.Session.getAnySessionInfo;
    readonly setSessionProviderIdAsync: typeof AppleUtils.Session.setSessionProviderIdAsync;
  };
  readonly CookieFileCache: {
    readonly getCookiesJSON: typeof AppleUtils.CookieFileCache.getCookiesJSON;
  };
}

const defaultAppleUtils: AppleUtilsContract = {
  Auth: AppleUtils.Auth,
  Session: AppleUtils.Session,
  CookieFileCache: AppleUtils.CookieFileCache,
};

/**
 * Resolved Apple Developer Portal session, ready to back entity-manager calls
 * (Certificate, BundleId, Profile, Device) via {@link AppleAuth.buildRequestContext}.
 */
export interface AppleAuthSession {
  readonly username: string;
  readonly teamId: string;
  readonly teamName: string | null;
  readonly providerId: number | undefined;
}

interface EnsureLoggedInOptions {
  /** Pre-fill the Apple ID prompt; falls back to last cached username. */
  readonly username?: string;
}

export class AppleAuth extends Context.Tag("cli/AppleAuth")<
  AppleAuth,
  {
    readonly ensureLoggedIn: (
      options?: EnsureLoggedInOptions,
    ) => Effect.Effect<
      AppleAuthSession,
      AppleAuthError | InteractiveProhibitedError,
      InteractiveMode | CliRuntime
    >;
    readonly logout: Effect.Effect<void>;
    readonly whoami: Effect.Effect<AppleAuthSession | null>;
    readonly buildRequestContext: (session: AppleAuthSession) => RequestContext;
  }
>() {}

const sessionFromAuthState = (state: Session.AuthState): AppleAuthSession => ({
  username: state.username,
  teamId: state.context.teamId ?? state.session.provider.publicProviderId,
  teamName: state.session.provider.name,
  providerId: state.context.providerId ?? state.session.provider.providerId,
});

const sessionFromInfo = (username: string, info: Session.SessionInfo): AppleAuthSession => ({
  username,
  teamId: info.provider.publicProviderId,
  teamName: info.provider.name,
  providerId: info.provider.providerId,
});

const sessionFromProvider = (
  username: string,
  provider: Session.SessionProvider,
): AppleAuthSession => ({
  username,
  teamId: provider.publicProviderId,
  teamName: provider.name,
  providerId: provider.providerId,
});

type RestoreInput = Parameters<AppleUtilsContract["Auth"]["loginWithCookiesAsync"]>[0];

const restoreFromCookies = (appleUtils: AppleUtilsContract, cookies: RestoreInput["cookies"]) =>
  Effect.tryPromise({
    try: async () =>
      // eslint-disable-next-line typescript/no-unsafe-assignment -- AppleSessionCookies resolves to `any` via tough-cookie's `CookieJar.Serialized`; round-tripped opaquely
      appleUtils.Auth.loginWithCookiesAsync({ cookies }),
    catch: (cause) =>
      new AppleAuthError({
        message: `Failed to restore Apple session: ${formatCause(cause)}`,
      }),
  });

/**
 * After a cookie restore or fresh credentials login, re-resolve the team via
 * {@link resolveProvider}. The cookies are accepted as-is (auth state) but the
 * team is treated as a per-run choice — we never trust a previously-cached team,
 * so a wrong pick can always be corrected on the next run.
 */
const resolveSessionTeam = (
  appleUtils: AppleUtilsContract,
  state: Session.AuthState,
): Effect.Effect<
  AppleAuthSession,
  AppleAuthError | InteractiveProhibitedError,
  InteractiveMode | CliRuntime
> =>
  Effect.gen(function* () {
    const { availableProviders } = state.session;
    const currentProviderId = state.context.providerId ?? state.session.provider.providerId;
    const resolution = yield* resolveProvider(appleUtils, availableProviders, currentProviderId);

    if (!resolution.switched || resolution.providerId === undefined) {
      return sessionFromAuthState(state);
    }

    const picked = availableProviders.find(
      (provider) => provider.providerId === resolution.providerId,
    );
    if (picked === undefined) {
      return yield* new AppleAuthError({
        message: `Selected provider ${String(resolution.providerId)} not in available providers list.`,
      });
    }
    return sessionFromProvider(state.username, picked);
  });

const loginWithCredentials = (appleUtils: AppleUtilsContract, credentials: Auth.UserCredentials) =>
  Effect.tryPromise({
    try: async () =>
      appleUtils.Auth.loginWithUserCredentialsAsync(credentials, { autoResolveProvider: true }),
    catch: (cause) =>
      new AppleAuthError({
        message: `Apple login failed: ${formatCause(cause)}`,
      }),
  });

const readJarCookies = (appleUtils: AppleUtilsContract): AppleSessionCookies =>
  appleUtils.CookieFileCache.getCookiesJSON();

const promptCredentials = (defaultUsername: string | undefined) =>
  Effect.gen(function* () {
    const username = yield* promptText(
      "Apple ID",
      defaultUsername === undefined
        ? { placeholder: "you@example.com" }
        : { defaultValue: defaultUsername, placeholder: defaultUsername },
    );
    const password = yield* promptPassword(`Password for ${username}`);
    return { username, password };
  });

const interactiveLogin = (
  appleUtils: AppleUtilsContract,
  options: EnsureLoggedInOptions,
  cachedUsername: string | null,
): Effect.Effect<
  AppleAuthSession,
  AppleAuthError | InteractiveProhibitedError,
  InteractiveMode | CliRuntime | AppleSessionStore
> =>
  Effect.gen(function* () {
    const store = yield* AppleSessionStore;
    const mode = yield* InteractiveMode;
    if (!mode.allow) {
      return yield* new InteractiveProhibitedError({
        message:
          "Apple ID login requires an interactive terminal. Re-run with --interactive or provide an ASC API key (APPLE_ASC_KEY_ID, APPLE_ASC_ISSUER_ID, APPLE_ASC_KEY).",
      });
    }
    const defaultUsername = options.username ?? cachedUsername;
    const { username, password } = yield* promptCredentials(
      defaultUsername === null ? undefined : defaultUsername,
    );
    yield* Effect.logInfo(`Authenticating with Apple as ${username}...`);
    const state = yield* loginWithCredentials(appleUtils, { username, password });
    if (state === null) {
      return yield* new AppleAuthError({
        message: "Apple login returned no session (unexpected).",
      });
    }
    const session = yield* resolveSessionTeam(appleUtils, state);
    yield* store.saveSession({
      // eslint-disable-next-line typescript/no-unsafe-assignment -- AppleSessionCookies resolves to `any` via tough-cookie's `CookieJar.Serialized`; round-tripped opaquely between apple-utils and the on-disk session store
      cookies: readJarCookies(appleUtils),
      username: session.username,
    });
    yield* store.saveLastUsername(session.username);
    return session;
  });

const tryRestore = (
  appleUtils: AppleUtilsContract,
  store: Context.Tag.Service<AppleSessionStore>,
): Effect.Effect<
  AppleAuthSession | null,
  AppleAuthError | InteractiveProhibitedError,
  InteractiveMode | CliRuntime
> =>
  Effect.gen(function* () {
    const stored = yield* store.loadSession;
    if (stored === null) {
      return null;
    }
    const restored = yield* restoreFromCookies(appleUtils, stored.cookies).pipe(
      Effect.orElseSucceed(() => null),
    );
    if (restored === null) {
      return null;
    }
    return yield* resolveSessionTeam(appleUtils, restored);
  });

export const makeAppleAuthLive = (appleUtils: AppleUtilsContract = defaultAppleUtils) =>
  Layer.effect(
    AppleAuth,
    Effect.gen(function* () {
      const store = yield* AppleSessionStore;
      return {
        ensureLoggedIn: (options: EnsureLoggedInOptions = {}) =>
          Effect.gen(function* () {
            const restored = yield* tryRestore(appleUtils, store);
            if (restored !== null) {
              return restored;
            }
            const cachedUsername = yield* store.loadLastUsername;
            return yield* interactiveLogin(appleUtils, options, cachedUsername).pipe(
              Effect.provideService(AppleSessionStore, store),
            );
          }),
        logout: store.clearSession.pipe(
          Effect.flatMap(() =>
            Effect.tryPromise({
              try: async () => appleUtils.Auth.logoutAsync(),
              catch: (cause) => new AppleAuthError({ message: formatCause(cause) }),
            }).pipe(Effect.catchAll(() => Effect.void)),
          ),
        ),
        whoami: Effect.gen(function* () {
          const stored = yield* store.loadSession;
          if (stored === null) {
            return null;
          }
          const restored = yield* restoreFromCookies(appleUtils, stored.cookies).pipe(
            Effect.orElseSucceed(() => null),
          );
          if (restored !== null) {
            return sessionFromAuthState(restored);
          }
          // Cookies expired — fall back to apple-utils' in-memory session info
          // (set during the current process if any). Return null when we can't
          // surface a team — we no longer cache teamId/providerId, so we'd
          // otherwise have nothing useful to show.
          const info = appleUtils.Session.getAnySessionInfo();
          return info === null ? null : sessionFromInfo(stored.username, info);
        }),
        buildRequestContext: (session: AppleAuthSession): RequestContext => ({
          teamId: session.teamId,
          ...compact({ providerId: session.providerId }),
        }),
      };
    }),
  );

export const AppleAuthLive = makeAppleAuthLive();
