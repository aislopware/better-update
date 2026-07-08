import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { safeJsonParse } from "@better-update/safe-json";
import { isRecord } from "@better-update/type-guards";
import { FileSystem } from "@effect/platform";
import { Entry } from "@napi-rs/keyring";
import { Context, Effect, Layer } from "effect";

import type { Auth } from "@expo/apple-utils";

import { AppleAuthError } from "../lib/exit-codes";
import { formatCause } from "../lib/format-error";
import { CliRuntime } from "./cli-runtime";

// The cookies payload accepted by @expo/apple-utils Auth.loginWithCookiesAsync.
// Derived structurally so we don't depend on the un-exported `CookiesJSON` alias.
export type AppleSessionCookies = Parameters<typeof Auth.loginWithCookiesAsync>[0]["cookies"];

// Team and provider are intentionally NOT persisted: the user must be free to
// re-pick a team each run (e.g. after picking the wrong one). The cookies still
// carry an apple-utils-internal "current team" hint, but the team is re-resolved
// (via env override, single-team auto-pick, or interactive prompt) on every
// `ensureLoggedIn` call so a stale pick can't lock the user out.
export interface SerializedAppleSession {
  readonly cookies: AppleSessionCookies;
  readonly username: string;
}

export class AppleSessionStore extends Context.Tag("cli/AppleSessionStore")<
  AppleSessionStore,
  {
    readonly loadSession: Effect.Effect<SerializedAppleSession | null>;
    readonly saveSession: (session: SerializedAppleSession) => Effect.Effect<void, AppleAuthError>;
    readonly clearSession: Effect.Effect<void>;
    /**
     * Last-used Apple ID for prompt pre-fill, persisted independently of the
     * cookie session. Survives `clearSession` (i.e. `apple logout`) so the next
     * login prompts with a default that matches the user's previous entry.
     */
    readonly loadLastUsername: Effect.Effect<string | null>;
    readonly saveLastUsername: (username: string) => Effect.Effect<void, AppleAuthError>;
  }
>() {}

const execFileAsync = promisify(execFile);

/** Keychain service + account the Apple ID cookie session is stored under. */
const KEYCHAIN_SERVICE = "better-update-apple";
const KEYCHAIN_ACCOUNT = "cookie-session";

const parseSession = (content: string): SerializedAppleSession | null => {
  const parsed = safeJsonParse(content);
  if (!isRecord(parsed)) {
    return null;
  }
  if (typeof parsed["username"] !== "string" || !parsed["cookies"]) {
    return null;
  }
  // eslint-disable-next-line typescript/no-unsafe-type-assertion, typescript/no-unsafe-assignment -- AppleSessionCookies is an opaque cookies payload from @expo/apple-utils; round-tripped verbatim from storage
  const cookies = parsed["cookies"] as AppleSessionCookies;
  return {
    // eslint-disable-next-line typescript/no-unsafe-assignment -- see disable on the `cookies` declaration above; same opaque value
    cookies,
    username: parsed["username"],
  };
};

/**
 * The Apple ID cookie session grants App Store Connect access, so it lives in
 * the OS keychain (`@napi-rs/keyring`: macOS Keychain / Windows Credential
 * Manager / Linux libsecret) — the same store as the vault-key cache — rather
 * than a plaintext file. Machines without a usable keychain (headless Linux
 * without libsecret, a locked login keychain, …) degrade to the legacy
 * `~/.better-update/apple-session.json` file (0600). A legacy file found while
 * the keychain works is migrated in and deleted.
 */
export const AppleSessionStoreLive = Layer.effect(
  AppleSessionStore,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const runtime = yield* CliRuntime;
    const homeDirectory = yield* runtime.homeDirectory;
    const sessionDir = path.join(homeDirectory, ".better-update");
    const sessionFile = path.join(sessionDir, "apple-session.json");
    const usernameFile = path.join(sessionDir, "apple-username.json");

    // All keyring access is best-effort — a broken keychain must degrade to the
    // file store, never crash a command.
    const readKeyring = Effect.try(() =>
      new Entry(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).getPassword(),
    ).pipe(Effect.orElseSucceed((): string | null => null));
    const deleteKeyring = Effect.try(() =>
      new Entry(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).deletePassword(),
    ).pipe(Effect.ignore);
    // The macOS keychain can hold an entry whose ACL is bound to a since-replaced
    // binary: the keyring API then can't read/update/delete it — only SecItemAdd
    // still collides. The `security` CLI can still find and delete such an item.
    const evictStaleKeyring = Effect.zipRight(
      deleteKeyring,
      process.platform === "darwin"
        ? Effect.tryPromise(async () =>
            execFileAsync("security", [
              "delete-generic-password",
              "-s",
              KEYCHAIN_SERVICE,
              "-a",
              KEYCHAIN_ACCOUNT,
            ]),
          ).pipe(Effect.ignore)
        : Effect.void,
    );
    const writeKeyring = (blob: string) => {
      const write = Effect.try(() => {
        new Entry(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).setPassword(blob);
      });
      return write.pipe(Effect.orElse(() => Effect.zipRight(evictStaleKeyring, write)));
    };

    const writeSessionFile = (session: SerializedAppleSession) =>
      Effect.gen(function* () {
        yield* fs.makeDirectory(sessionDir, { recursive: true });
        yield* fs.chmod(sessionDir, 0o700);
        yield* fs.writeFileString(sessionFile, `${JSON.stringify(session, null, 2)}\n`);
        yield* fs.chmod(sessionFile, 0o600);
      });

    const removeSessionFile = fs.remove(sessionFile).pipe(Effect.catchAll(() => Effect.void));

    return {
      loadSession: Effect.gen(function* () {
        const fromKeyring = yield* readKeyring;
        if (fromKeyring !== null) {
          return parseSession(fromKeyring);
        }
        // Legacy plaintext file (pre-keychain releases): migrate it into the
        // keychain and delete it, best-effort — a failed migration just leaves
        // the file for the next run.
        const content = yield* fs
          .readFileString(sessionFile)
          .pipe(Effect.orElseSucceed(() => null));
        if (content === null) {
          return null;
        }
        const session = parseSession(content);
        if (session !== null) {
          yield* writeKeyring(content).pipe(
            Effect.zipRight(removeSessionFile),
            Effect.catchAll(() => Effect.void),
          );
        }
        return session;
      }),

      saveSession: (session: SerializedAppleSession) =>
        writeKeyring(JSON.stringify(session)).pipe(
          // Keychain write succeeded — drop any stale plaintext copy.
          Effect.zipRight(removeSessionFile),
          Effect.orElse(() => writeSessionFile(session)),
          Effect.mapError(
            (cause) =>
              new AppleAuthError({
                message: `Failed to save Apple session: ${formatCause(cause)}`,
              }),
          ),
        ),

      clearSession: Effect.zipRight(deleteKeyring, removeSessionFile),

      loadLastUsername: Effect.gen(function* () {
        const content = yield* fs
          .readFileString(usernameFile)
          .pipe(Effect.orElseSucceed(() => null));
        if (!content) {
          return null;
        }
        const parsed = safeJsonParse(content);
        if (!isRecord(parsed) || typeof parsed["username"] !== "string") {
          return null;
        }
        return parsed["username"];
      }),

      saveLastUsername: (username: string) =>
        Effect.gen(function* () {
          yield* fs.makeDirectory(sessionDir, { recursive: true });
          yield* fs.chmod(sessionDir, 0o700);
          yield* fs.writeFileString(usernameFile, `${JSON.stringify({ username }, null, 2)}\n`);
          yield* fs.chmod(usernameFile, 0o600);
        }).pipe(
          Effect.mapError(
            (cause) =>
              new AppleAuthError({
                message: `Failed to save Apple username: ${formatCause(cause)}`,
              }),
          ),
        ),
    };
  }),
);
