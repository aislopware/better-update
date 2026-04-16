import { Prompt } from "@effect/cli";
import { FileSystem } from "@effect/platform";
import { Console, Effect } from "effect";

import type * as Terminal from "@effect/platform/Terminal";

import { AppleSessionStore } from "../services/apple-session-store";
import { CliRuntime } from "../services/cli-runtime";
import { importAppleUtils } from "./apple-utils-import";
import { AppleAuthError } from "./exit-codes";

// ── types ────────────────────────────────────────────────────────

export interface AppleAuthContext {
  readonly teamId: string;
  // Opaque RequestContext from @expo/apple-utils — threaded through all portal calls.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- typed internally by apple-utils
  readonly requestContext: any;
}

// ── internal helpers ─────────────────────────────────────────────

const KEYCHAIN_SERVICE = "better-update-apple-id";

const loadAppleUtils = () => importAppleUtils((message) => new AppleAuthError({ message }));

const readEnv = (name: string) =>
  Effect.gen(function* () {
    const runtime = yield* CliRuntime;
    return yield* runtime.getEnv(name);
  });

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

  yield* Console.log(`Authenticated with ASC API Key (Team: ${teamId})`);

  return { teamId, requestContext: { token, teamId } } satisfies AppleAuthContext;
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
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- CookiesJSON from tough-cookie
          { cookies: savedSession.cookies as never },
          { autoResolveProvider: true },
        ),
      catch: () => undefined,
    }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));

    if (restored) {
      yield* Console.log("Apple session restored successfully.");
      return {
        teamId: savedSession.teamId,
        requestContext: restored.context,
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

  // 5. Persist session for next run.
  yield* sessionStore.saveSession({
    cookies: authState.cookies,
    teamId,
    username,
  });

  // 6. Cache password in macOS Keychain for next session expiry.
  if (!envPassword) {
    yield* saveKeychainPassword(username, password);
  }

  yield* Console.log(`Authenticated as ${username} (Team: ${teamId})`);

  return {
    teamId,
    requestContext: { ...authState.context, teamId },
  } satisfies AppleAuthContext;
});

// ── public API ───────────────────────────────────────────────────

/**
 * Authenticate with Apple Developer Portal.
 *
 * Auto-detects auth mode:
 * - If APPLE_ASC_KEY_PATH + APPLE_ASC_KEY_ID + APPLE_ASC_ISSUER_ID are set → ASC API Key (CI)
 * - Otherwise → interactive Apple ID + password + 2FA
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
