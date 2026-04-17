import { Prompt } from "@effect/cli";
import { FileSystem } from "@effect/platform";
import { Console, Effect } from "effect";

import type * as Terminal from "@effect/platform/Terminal";
import type * as AppleUtils from "@expo/apple-utils";
import type { RequestContext } from "@expo/apple-utils";

import { AppleSessionStore } from "../services/apple-session-store";
import { CliRuntime } from "../services/cli-runtime";
import { importAppleUtils } from "./apple-utils-import";
import { AppleAuthError } from "./exit-codes";

type SessionProvider = AppleUtils.Session.SessionProvider;
type CookiesJSON = AppleUtils.CookieFileCache.CookiesJSON;

// ── types ────────────────────────────────────────────────────────

export interface AppleAuthContext {
  readonly teamId: string;
  readonly requestContext: RequestContext;
}

interface ProviderResolution {
  readonly providerId: number | undefined;
  readonly switched: boolean;
}

// ── internal helpers ─────────────────────────────────────────────

const KEYCHAIN_SERVICE = "better-update-apple-id";
const APPLE_PROVIDER_ID_ENV = "APPLE_PROVIDER_ID";

const loadAppleUtils = () => importAppleUtils((message) => new AppleAuthError({ message }));

const readEnv = (name: string) =>
  Effect.gen(function* () {
    const runtime = yield* CliRuntime;
    return yield* runtime.getEnv(name);
  });

const withProviderId = <T extends object>(
  base: T,
  providerId: number | undefined,
): T & { providerId?: number } => (providerId === undefined ? base : { ...base, providerId });

const formatProviderSuffix = (providerId: number | undefined) =>
  providerId === undefined ? "" : `, Provider: ${providerId}`;

// ── macOS Keychain helpers (non-blocking, darwin-only) ───────────

const getKeychainPassword = (
  account: string,
): Effect.Effect<string | undefined, never, CliRuntime> =>
  Effect.gen(function* () {
    const runtime = yield* CliRuntime;
    if (runtime.platform !== "darwin") return undefined;
    return yield* Effect.tryPromise({
      try: async () => {
        const kc = (await import("keychain")) as {
          default: {
            getPassword: (
              opts: { account: string; service: string },
              cb: (err: Error | null, pw?: string) => void,
            ) => void;
          };
        };
        return new Promise<string | undefined>((resolve) => {
          kc.default.getPassword({ account, service: KEYCHAIN_SERVICE }, (err, pw) => {
            resolve(err ? undefined : pw);
          });
        });
      },
      catch: () => undefined,
    }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
  });

const saveKeychainPassword = (
  account: string,
  password: string,
): Effect.Effect<void, never, CliRuntime> =>
  Effect.gen(function* () {
    const runtime = yield* CliRuntime;
    if (runtime.platform !== "darwin") return;
    yield* Effect.tryPromise({
      try: async () => {
        const kc = (await import("keychain")) as {
          default: {
            setPassword: (
              opts: { account: string; service: string; password: string },
              cb: (err: Error | null) => void,
            ) => void;
          };
        };
        return new Promise<void>((resolve) => {
          kc.default.setPassword({ account, service: KEYCHAIN_SERVICE, password }, () => {
            resolve();
          });
        });
      },
      catch: () => undefined,
    }).pipe(Effect.catchAll(() => Effect.void));
  });

// ── Provider resolution ──────────────────────────────────────────

export const parseProviderId = (raw: string): Effect.Effect<number, AppleAuthError> => {
  const id = Number(raw);
  return Number.isInteger(id)
    ? Effect.succeed(id)
    : Effect.fail(
        new AppleAuthError({
          message: `${APPLE_PROVIDER_ID_ENV} must be a numeric provider ID, got "${raw}".`,
        }),
      );
};

const readEnvProviderId: Effect.Effect<number | undefined, AppleAuthError, CliRuntime> = Effect.gen(
  function* () {
    const raw = yield* readEnv(APPLE_PROVIDER_ID_ENV);
    if (!raw) return undefined;
    return yield* parseProviderId(raw);
  },
);

const switchSessionProvider = (
  appleUtils: typeof AppleUtils,
  providerId: number,
): Effect.Effect<void, AppleAuthError> =>
  Effect.tryPromise({
    try: () => appleUtils.Session.setSessionProviderIdAsync(providerId),
    catch: (error) =>
      new AppleAuthError({
        message: `Failed to switch App Store Connect provider (${providerId}): ${String(error)}`,
      }),
  }).pipe(Effect.asVoid);

const extractCurrentCookies = (appleUtils: typeof AppleUtils): CookiesJSON =>
  appleUtils.CookieFileCache.getCookiesJSON();

const isProviderAvailable = (
  providers: ReadonlyArray<SessionProvider>,
  providerId: number,
): boolean => providers.some((p) => p.providerId === providerId);

/**
 * Resolve App Store Connect provider for an interactive session.
 *
 * Selection order: APPLE_PROVIDER_ID env → valid cached pick → single available
 * → preserve apple-utils' auto-resolved provider → prompt.
 *
 * `switched` flags that the apple-utils cookie jar was mutated; previously-captured
 * cookies are stale and callers should re-extract via {@link extractCurrentCookies}.
 *
 * Headless-safe: prompt only fires when no env, no valid cache, multiple providers,
 * AND apple-utils returned no auto-resolved provider.
 */
export const resolveProvider = (
  appleUtils: typeof AppleUtils,
  availableProviders: ReadonlyArray<SessionProvider>,
  currentProviderId: number | undefined,
  cachedProviderId: number | undefined,
): Effect.Effect<
  ProviderResolution,
  AppleAuthError | Terminal.QuitException,
  CliRuntime | Terminal.Terminal
> =>
  Effect.gen(function* () {
    let switched = false;

    const applyChoice = (picked: number) =>
      Effect.gen(function* () {
        if (currentProviderId !== picked) {
          yield* switchSessionProvider(appleUtils, picked);
          switched = true;
        }
        return picked;
      });

    const envId = yield* readEnvProviderId;
    if (envId !== undefined) {
      const id = yield* applyChoice(envId);
      return { providerId: id, switched };
    }

    if (
      cachedProviderId !== undefined &&
      isProviderAvailable(availableProviders, cachedProviderId)
    ) {
      const id = yield* applyChoice(cachedProviderId);
      return { providerId: id, switched };
    }

    if (availableProviders.length === 0) {
      return { providerId: currentProviderId, switched };
    }
    if (availableProviders.length === 1) {
      const id = yield* applyChoice(availableProviders[0]!.providerId);
      return { providerId: id, switched };
    }

    // Multi-provider, no explicit signal: respect apple-utils auto-resolution
    // (CI-safe). Only fall through to prompt when apple-utils returned nothing.
    if (currentProviderId !== undefined) {
      return { providerId: currentProviderId, switched };
    }

    const picked = yield* Prompt.select({
      message: "Select App Store Connect provider:",
      choices: availableProviders.map((provider) => ({
        title: `${provider.name} [${provider.subType}] (${provider.providerId})`,
        value: provider.providerId,
      })),
    });

    const id = yield* applyChoice(picked);
    return { providerId: id, switched };
  });

// ── ASC API key auth (CI) ────────────────────────────────────────

const authenticateWithAscApiKey: Effect.Effect<
  AppleAuthContext,
  AppleAuthError,
  CliRuntime | FileSystem.FileSystem
> = Effect.gen(function* () {
  const keyPath = yield* readEnv("APPLE_ASC_KEY_PATH");
  const keyId = yield* readEnv("APPLE_ASC_KEY_ID");
  const issuerId = yield* readEnv("APPLE_ASC_ISSUER_ID");
  const teamId = yield* readEnv("APPLE_TEAM_ID");

  if (!keyPath || !keyId || !issuerId || !teamId) {
    return yield* new AppleAuthError({
      message:
        "ASC API Key auth requires APPLE_ASC_KEY_PATH, APPLE_ASC_KEY_ID, APPLE_ASC_ISSUER_ID, and APPLE_TEAM_ID environment variables.",
    });
  }

  const fs = yield* FileSystem.FileSystem;
  const keyContent = yield* fs
    .readFileString(keyPath)
    .pipe(
      Effect.mapError(
        () => new AppleAuthError({ message: `Failed to read ASC API key file: ${keyPath}` }),
      ),
    );

  const appleUtils = yield* loadAppleUtils();
  const token = new appleUtils.Token({ key: keyContent, keyId, issuerId, duration: 1200 });

  const providerId = yield* readEnvProviderId;

  yield* Console.log(
    `Authenticated with ASC API Key (Team: ${teamId}${formatProviderSuffix(providerId)})`,
  );

  return {
    teamId,
    requestContext: withProviderId({ token, teamId }, providerId),
  } satisfies AppleAuthContext;
});

// ── Apple ID auth (interactive) ──────────────────────────────────

const authenticateWithAppleId: Effect.Effect<
  AppleAuthContext,
  AppleAuthError | Terminal.QuitException,
  CliRuntime | FileSystem.FileSystem | AppleSessionStore | Terminal.Terminal
> = Effect.gen(function* () {
  const appleUtils = yield* loadAppleUtils();
  const sessionStore = yield* AppleSessionStore;

  // 1. Try restoring from saved session cookies.
  const savedSession = yield* sessionStore.loadSession;

  if (savedSession) {
    yield* Console.log(`Restoring Apple session for ${savedSession.username}...`);

    const restored = yield* Effect.tryPromise({
      try: () =>
        appleUtils.Auth.loginWithCookiesAsync(
          { cookies: savedSession.cookies },
          { autoResolveProvider: true },
        ),
      catch: () => undefined,
    }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));

    if (restored) {
      yield* Console.log("Apple session restored successfully.");
      const { providerId: restoredProviderId, switched } = yield* resolveProvider(
        appleUtils,
        restored.session.availableProviders,
        restored.session.provider?.providerId,
        savedSession.providerId,
      );

      const providerChanged = restoredProviderId !== savedSession.providerId;
      if (switched || providerChanged) {
        const cookiesToPersist = switched ? extractCurrentCookies(appleUtils) : restored.cookies;
        yield* sessionStore.saveSession(
          withProviderId(
            {
              cookies: cookiesToPersist,
              teamId: savedSession.teamId,
              username: savedSession.username,
            },
            restoredProviderId,
          ),
        );
      }

      return {
        teamId: savedSession.teamId,
        requestContext: withProviderId(restored.context, restoredProviderId),
      } satisfies AppleAuthContext;
    }

    yield* Console.log("Saved session expired. Logging in again...");
    yield* sessionStore.clearSession;
  }

  // 2. Prompt for credentials (or read from env, or macOS Keychain).
  const envUsername = yield* readEnv("APPLE_ID");
  const envPassword = yield* readEnv("APPLE_ID_PASSWORD");

  const username = envUsername ?? (yield* Prompt.text({ message: "Apple ID:" }));

  // Try macOS Keychain before prompting for password
  const cachedPassword = envPassword ? undefined : yield* getKeychainPassword(username);
  if (cachedPassword) {
    yield* Console.log("Using password from macOS Keychain.");
  }

  const password =
    envPassword ??
    cachedPassword ??
    (yield* Prompt.password({
      message: "Password (or app-specific password):",
    }).pipe(Effect.map((r) => (typeof r === "string" ? r : String(r)))));

  // 3. Login — @expo/apple-utils handles 2FA internally.
  yield* Console.log("Authenticating with Apple Developer Portal...");

  const authState = yield* Effect.tryPromise({
    try: () =>
      appleUtils.Auth.loginWithUserCredentialsAsync(
        { username, password },
        { autoResolveProvider: true },
      ),
    catch: (error) =>
      new AppleAuthError({
        message: `Apple authentication failed: ${String(error)}`,
      }),
  });

  if (!authState) {
    return yield* new AppleAuthError({
      message: "Apple authentication returned no session. Check your credentials and try again.",
    });
  }

  // 4. Resolve team.
  const envTeamId = yield* readEnv("APPLE_TEAM_ID");
  let teamId: string;

  if (envTeamId) {
    teamId = envTeamId;
  } else if (authState.context.teamId) {
    teamId = authState.context.teamId;
  } else {
    const teams = yield* Effect.tryPromise({
      try: () => appleUtils.Teams.getTeamsAsync(),
      catch: () => new AppleAuthError({ message: "Failed to fetch Apple Developer teams." }),
    });

    if (teams.length === 0) {
      return yield* new AppleAuthError({
        message: "No Apple Developer teams found for this account.",
      });
    }

    if (teams.length === 1) {
      teamId = teams[0]!.teamId;
    } else {
      teamId = yield* Prompt.select({
        message: "Select Apple Developer team:",
        choices: teams.map((team) => ({
          title: `${team.name} (${team.teamId})`,
          value: team.teamId,
        })),
      });
    }
  }

  // 5. Resolve App Store Connect provider.
  const { providerId, switched } = yield* resolveProvider(
    appleUtils,
    authState.session.availableProviders,
    authState.session.provider?.providerId,
    undefined,
  );

  // 6. Persist session for next run (use post-switch cookies if provider changed).
  const cookiesToPersist = switched ? extractCurrentCookies(appleUtils) : authState.cookies;
  yield* sessionStore.saveSession(
    withProviderId({ cookies: cookiesToPersist, teamId, username }, providerId),
  );

  // 7. Cache password in macOS Keychain for next session expiry.
  if (!envPassword) {
    yield* saveKeychainPassword(username, password);
  }

  yield* Console.log(
    `Authenticated as ${username} (Team: ${teamId}${formatProviderSuffix(providerId)})`,
  );

  return {
    teamId,
    requestContext: withProviderId({ ...authState.context, teamId }, providerId),
  } satisfies AppleAuthContext;
});

// ── public API ───────────────────────────────────────────────────

/**
 * Authenticate with Apple Developer Portal.
 *
 * Auto-detects auth mode:
 * - If APPLE_ASC_KEY_PATH + APPLE_ASC_KEY_ID + APPLE_ASC_ISSUER_ID are set → ASC API Key (CI)
 * - Otherwise → interactive Apple ID + password + 2FA
 *
 * Team selection (Apple ID flow): APPLE_TEAM_ID env > cached session > prompt when multiple.
 * Provider selection (Apple ID flow): APPLE_PROVIDER_ID env > valid cached pick > single
 *   available > apple-utils auto-resolution > prompt. CI-safe — only prompts when no
 *   explicit signal and apple-utils returned no auto-resolved provider.
 * ASC API key flow honors APPLE_PROVIDER_ID env only (never prompts, never caches).
 */
export const authenticateWithApple: Effect.Effect<
  AppleAuthContext,
  AppleAuthError | Terminal.QuitException,
  AppleSessionStore | CliRuntime | FileSystem.FileSystem | Terminal.Terminal
> = Effect.gen(function* () {
  const runtime = yield* CliRuntime;
  const hasAscKey = yield* runtime.getEnv("APPLE_ASC_KEY_PATH");
  const hasAscKeyId = yield* runtime.getEnv("APPLE_ASC_KEY_ID");
  const hasAscIssuerId = yield* runtime.getEnv("APPLE_ASC_ISSUER_ID");

  if (hasAscKey && hasAscKeyId && hasAscIssuerId) {
    yield* Console.log("Using ASC API Key authentication (detected from environment).");
    return yield* authenticateWithAscApiKey;
  }

  return yield* authenticateWithAppleId;
});
