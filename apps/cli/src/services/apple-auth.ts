// @expo/apple-utils is ncc-bundled CJS; `import * as` only surfaces `default`/`module.exports`
// via Node ESM's cjs-module-lexer, so Auth/Session/CookieFileCache are read off the default import.
import AppleUtils from "@expo/apple-utils";
import { Context, Effect, Layer } from "effect";

import type { Auth, RequestContext, Session } from "@expo/apple-utils";

import { AppleAuthError, InteractiveProhibitedError } from "../lib/exit-codes";
import { formatCause } from "../lib/format-error";
import { InteractiveMode } from "../lib/interactive-mode";
import { promptPassword, promptText } from "../lib/prompts";
import { AppleSessionStore } from "./apple-session-store";

import type { AppleSessionCookies } from "./apple-session-store";

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
      InteractiveMode
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

type RestoreInput = Parameters<AppleUtilsContract["Auth"]["loginWithCookiesAsync"]>[0];

const restoreFromCookies = (
  appleUtils: AppleUtilsContract,
  cookies: RestoreInput["cookies"],
  providerId: number | undefined,
  teamId: string | undefined,
) =>
  Effect.tryPromise({
    try: async () => {
      const input: RestoreInput & { providerId?: number; teamId?: string } = {
        cookies,
        ...(providerId === undefined ? {} : { providerId }),
        ...(teamId === undefined ? {} : { teamId }),
      };
      return appleUtils.Auth.loginWithCookiesAsync(input);
    },
    catch: (cause) =>
      new AppleAuthError({
        message: `Failed to restore Apple session: ${formatCause(cause)}`,
      }),
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
  InteractiveMode | AppleSessionStore
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
    const session = sessionFromAuthState(state);
    yield* store.saveSession({
      // eslint-disable-next-line typescript/no-unsafe-assignment -- AppleSessionCookies resolves to `any` via tough-cookie's `CookieJar.Serialized`; round-tripped opaquely between apple-utils and the on-disk session store
      cookies: readJarCookies(appleUtils),
      username: session.username,
      teamId: session.teamId,
      ...(session.providerId === undefined ? {} : { providerId: session.providerId }),
    });
    yield* store.saveLastUsername(session.username);
    return session;
  });

const tryRestore = (
  appleUtils: AppleUtilsContract,
  store: Context.Tag.Service<AppleSessionStore>,
): Effect.Effect<AppleAuthSession | null, AppleAuthError> =>
  Effect.gen(function* () {
    const stored = yield* store.loadSession;
    if (stored === null) {
      return null;
    }
    const restored = yield* restoreFromCookies(
      appleUtils,
      stored.cookies,
      stored.providerId,
      stored.teamId,
    );
    if (restored === null) {
      return null;
    }
    return sessionFromAuthState(restored);
  });

export const makeAppleAuthLive = (appleUtils: AppleUtilsContract = defaultAppleUtils) =>
  Layer.effect(
    AppleAuth,
    Effect.gen(function* () {
      const store = yield* AppleSessionStore;
      return {
        ensureLoggedIn: (options: EnsureLoggedInOptions = {}) =>
          Effect.gen(function* () {
            const restored = yield* tryRestore(appleUtils, store).pipe(
              Effect.catchAll(() => Effect.succeed(null)),
            );
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
          const restored = yield* restoreFromCookies(
            appleUtils,
            stored.cookies,
            stored.providerId,
            stored.teamId,
          ).pipe(Effect.catchAll(() => Effect.succeed(null)));
          if (restored !== null) {
            return sessionFromAuthState(restored);
          }
          // Cookies expired but we know who they were — surface that for `whoami`
          // Without forcing a re-login here.
          const info = appleUtils.Session.getAnySessionInfo();
          return info === null
            ? {
                username: stored.username,
                teamId: stored.teamId,
                teamName: null,
                providerId: stored.providerId,
              }
            : sessionFromInfo(stored.username, info);
        }),
        buildRequestContext: (session: AppleAuthSession): RequestContext => ({
          teamId: session.teamId,
          ...(session.providerId === undefined ? {} : { providerId: session.providerId }),
        }),
      };
    }),
  );

export const AppleAuthLive = makeAppleAuthLive();
