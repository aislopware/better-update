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

/** Roster of Apple IDs with a cached session + which one commands act as. */
export interface AppleAccountsIndex {
  readonly active: string | null;
  readonly accounts: readonly string[];
}

/** Apple IDs are email addresses — compare and key them case-insensitively. */
export const normalizeAppleUsername = (username: string): string => username.trim().toLowerCase();

export class AppleSessionStore extends Context.Tag("cli/AppleSessionStore")<
  AppleSessionStore,
  {
    /** Session of the active account, or null when none is active/cached. */
    readonly loadSession: Effect.Effect<SerializedAppleSession | null>;
    /** Session cached for a specific Apple ID (case-insensitive), if any. */
    readonly loadSessionFor: (username: string) => Effect.Effect<SerializedAppleSession | null>;
    /** Persist a session under its Apple ID and make that account active. */
    readonly saveSession: (session: SerializedAppleSession) => Effect.Effect<void, AppleAuthError>;
    /** Drop the active account's session and deactivate it; others stay cached. */
    readonly clearSession: Effect.Effect<void>;
    /** Drop every cached account session. */
    readonly clearAllSessions: Effect.Effect<void>;
    readonly listAccounts: Effect.Effect<AppleAccountsIndex>;
    /** Mark an Apple ID as the active account (added to the roster if missing). */
    readonly setActiveAccount: (username: string) => Effect.Effect<void, AppleAuthError>;
    /**
     * Last-used Apple ID for prompt pre-fill, persisted independently of the
     * cookie sessions. Survives `clearSession` (i.e. `apple logout`) so the next
     * login prompts with a default that matches the user's previous entry.
     */
    readonly loadLastUsername: Effect.Effect<string | null>;
    readonly saveLastUsername: (username: string) => Effect.Effect<void, AppleAuthError>;
  }
>() {}

const execFileAsync = promisify(execFile);

/** Keychain service the Apple ID cookie sessions are stored under. */
const KEYCHAIN_SERVICE = "better-update-apple";
/** Pre-multi-account releases stored the single session under this account. */
const LEGACY_KEYCHAIN_ACCOUNT = "cookie-session";
/** One keychain entry per Apple ID, mirroring vault-cache's account namespacing. */
const keychainAccount = (normalizedUsername: string): string =>
  `${LEGACY_KEYCHAIN_ACCOUNT}:${normalizedUsername}`;

const parseSessionValue = (value: unknown): SerializedAppleSession | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value["username"] !== "string" || !value["cookies"]) {
    return null;
  }
  // eslint-disable-next-line typescript/no-unsafe-type-assertion, typescript/no-unsafe-assignment -- AppleSessionCookies is an opaque cookies payload from @expo/apple-utils; round-tripped verbatim from storage
  const cookies = value["cookies"] as AppleSessionCookies;
  return {
    // eslint-disable-next-line typescript/no-unsafe-assignment -- see disable on the `cookies` declaration above; same opaque value
    cookies,
    username: value["username"],
  };
};

const parseSession = (content: string): SerializedAppleSession | null =>
  parseSessionValue(safeJsonParse(content));

const EMPTY_INDEX: AppleAccountsIndex = { active: null, accounts: [] };

const parseIndex = (content: string): AppleAccountsIndex => {
  const parsed = safeJsonParse(content);
  if (!isRecord(parsed)) {
    return EMPTY_INDEX;
  }
  const rawAccounts = parsed["accounts"];
  const accounts = Array.isArray(rawAccounts)
    ? rawAccounts.filter((entry): entry is string => typeof entry === "string")
    : [];
  const active =
    typeof parsed["active"] === "string" && accounts.includes(parsed["active"])
      ? parsed["active"]
      : null;
  return { active, accounts };
};

/** Fallback-file payload: sessions keyed by normalized Apple ID. */
const parseSessionsFile = (content: string): Readonly<Record<string, SerializedAppleSession>> => {
  const parsed = safeJsonParse(content);
  const sessions = isRecord(parsed) ? parsed["sessions"] : null;
  if (!isRecord(sessions)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(sessions).flatMap(([username, value]) => {
      const session = parseSessionValue(value);
      return session === null ? [] : [[username, session] as const];
    }),
  );
};

// All keyring access is best-effort — a broken keychain must degrade to the
// file store, never crash a command.
const readKeyring = (account: string) =>
  Effect.try(() => new Entry(KEYCHAIN_SERVICE, account).getPassword()).pipe(
    Effect.orElseSucceed((): string | null => null),
  );
const deleteKeyring = (account: string) =>
  Effect.try(() => new Entry(KEYCHAIN_SERVICE, account).deletePassword()).pipe(Effect.ignore);
// The macOS keychain can hold an entry whose ACL is bound to a since-replaced
// binary: the keyring API then can't read/update/delete it — only SecItemAdd
// still collides. The `security` CLI can still find and delete such an item.
const evictStaleKeyring = (account: string) =>
  Effect.zipRight(
    deleteKeyring(account),
    process.platform === "darwin"
      ? Effect.tryPromise(async () =>
          execFileAsync("security", [
            "delete-generic-password",
            "-s",
            KEYCHAIN_SERVICE,
            "-a",
            account,
          ]),
        ).pipe(Effect.ignore)
      : Effect.void,
  );
const writeKeyring = (account: string, blob: string) => {
  const write = Effect.try(() => {
    new Entry(KEYCHAIN_SERVICE, account).setPassword(blob);
  });
  return write.pipe(Effect.orElse(() => Effect.zipRight(evictStaleKeyring(account), write)));
};

/**
 * Apple ID cookie sessions grant App Store Connect access, so they live in the
 * OS keychain (`@napi-rs/keyring`: macOS Keychain / Windows Credential Manager /
 * Linux libsecret) — the same store as the vault-key cache — rather than a
 * plaintext file, one entry per Apple ID (`cookie-session:<apple-id>`). Which
 * accounts exist and which is active lives in `~/.better-update/apple-accounts.json`
 * (keyring has no "list accounts for service" API). Machines without a usable
 * keychain degrade to `~/.better-update/apple-sessions.json` (0600). Legacy
 * single-account storage (keychain entry `cookie-session`, plaintext
 * `apple-session.json`) is migrated in on first access.
 */
export const AppleSessionStoreLive = Layer.effect(
  AppleSessionStore,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const runtime = yield* CliRuntime;
    const homeDirectory = yield* runtime.homeDirectory;
    const sessionDir = path.join(homeDirectory, ".better-update");
    const legacySessionFile = path.join(sessionDir, "apple-session.json");
    const sessionsFile = path.join(sessionDir, "apple-sessions.json");
    const indexFile = path.join(sessionDir, "apple-accounts.json");
    const usernameFile = path.join(sessionDir, "apple-username.json");

    const writeSecureFile = (file: string, payload: unknown) =>
      Effect.gen(function* () {
        yield* fs.makeDirectory(sessionDir, { recursive: true });
        yield* fs.chmod(sessionDir, 0o700);
        yield* fs.writeFileString(file, `${JSON.stringify(payload, null, 2)}\n`);
        yield* fs.chmod(file, 0o600);
      });

    const readFileOrNull = (file: string) =>
      fs.readFileString(file).pipe(Effect.orElseSucceed((): string | null => null));

    const removeFile = (file: string) => fs.remove(file).pipe(Effect.catchAll(() => Effect.void));

    const readIndex = readFileOrNull(indexFile).pipe(
      Effect.map((content) => (content === null ? EMPTY_INDEX : parseIndex(content))),
    );
    const writeIndex = (index: AppleAccountsIndex) => writeSecureFile(indexFile, index);

    const readSessionsFile = readFileOrNull(sessionsFile).pipe(
      Effect.map((content) => (content === null ? {} : parseSessionsFile(content))),
    );
    const writeSessionsFile = (sessions: Readonly<Record<string, SerializedAppleSession>>) =>
      Object.keys(sessions).length === 0
        ? removeFile(sessionsFile)
        : writeSecureFile(sessionsFile, { sessions });

    const dropFromSessionsFile = (normalized: string) =>
      Effect.gen(function* () {
        const sessions = yield* readSessionsFile;
        if (!(normalized in sessions)) {
          return;
        }
        yield* writeSessionsFile(
          Object.fromEntries(Object.entries(sessions).filter(([key]) => key !== normalized)),
        );
      }).pipe(Effect.catchAll(() => Effect.void));

    /** Register an account in the index; keeps the current active unless absent. */
    const indexAccount = (normalized: string, options: { readonly activate: boolean }) =>
      Effect.gen(function* () {
        const index = yield* readIndex;
        const accounts = index.accounts.includes(normalized)
          ? index.accounts
          : [...index.accounts, normalized];
        const active = options.activate ? normalized : (index.active ?? normalized);
        yield* writeIndex({ active, accounts });
      });

    const persistSession = (normalized: string, session: SerializedAppleSession) =>
      writeKeyring(keychainAccount(normalized), JSON.stringify(session)).pipe(
        // Keychain write succeeded — drop any stale plaintext copy.
        Effect.zipRight(dropFromSessionsFile(normalized)),
        Effect.orElse(() =>
          readSessionsFile.pipe(
            Effect.flatMap((sessions) => writeSessionsFile({ ...sessions, [normalized]: session })),
          ),
        ),
      );

    // Legacy single-account storage → per-account entries + index, best-effort:
    // a failed migration just leaves the legacy copy for the next run.
    const migrateLegacy = Effect.gen(function* () {
      const fromKeyring = yield* readKeyring(LEGACY_KEYCHAIN_ACCOUNT);
      const keyringSession = fromKeyring === null ? null : parseSession(fromKeyring);
      if (keyringSession !== null) {
        const normalized = normalizeAppleUsername(keyringSession.username);
        yield* persistSession(normalized, keyringSession);
        yield* indexAccount(normalized, { activate: false });
        yield* deleteKeyring(LEGACY_KEYCHAIN_ACCOUNT);
      }
      const fromFile = yield* readFileOrNull(legacySessionFile);
      const fileSession = fromFile === null ? null : parseSession(fromFile);
      if (fileSession !== null) {
        const normalized = normalizeAppleUsername(fileSession.username);
        // The keychain copy is newer than the pre-keychain plaintext file — keep it.
        const existing = yield* readKeyring(keychainAccount(normalized));
        if (existing === null) {
          yield* persistSession(normalized, fileSession);
          yield* indexAccount(normalized, { activate: false });
        }
        yield* removeFile(legacySessionFile);
      }
    }).pipe(Effect.catchAll(() => Effect.void));
    const ensureMigrated = yield* Effect.cached(migrateLegacy);

    const loadSessionFor = (username: string) =>
      Effect.gen(function* () {
        yield* ensureMigrated;
        const normalized = normalizeAppleUsername(username);
        const fromKeyring = yield* readKeyring(keychainAccount(normalized));
        if (fromKeyring !== null) {
          return parseSession(fromKeyring);
        }
        const sessions = yield* readSessionsFile;
        const fallback = sessions[normalized];
        return fallback === undefined ? null : fallback;
      });

    return {
      loadSession: Effect.gen(function* () {
        yield* ensureMigrated;
        const index = yield* readIndex;
        if (index.active === null) {
          return null;
        }
        return yield* loadSessionFor(index.active);
      }),

      loadSessionFor,

      saveSession: (session: SerializedAppleSession) =>
        Effect.gen(function* () {
          const normalized = normalizeAppleUsername(session.username);
          yield* ensureMigrated;
          yield* persistSession(normalized, session);
          yield* indexAccount(normalized, { activate: true });
        }).pipe(
          Effect.mapError(
            (cause) =>
              new AppleAuthError({
                message: `Failed to save Apple session: ${formatCause(cause)}`,
              }),
          ),
        ),

      clearSession: Effect.gen(function* () {
        yield* ensureMigrated;
        const index = yield* readIndex;
        if (index.active === null) {
          return;
        }
        const normalized = index.active;
        yield* deleteKeyring(keychainAccount(normalized));
        yield* dropFromSessionsFile(normalized);
        yield* writeIndex({
          active: null,
          accounts: index.accounts.filter((account) => account !== normalized),
        }).pipe(Effect.catchAll(() => Effect.void));
      }),

      clearAllSessions: Effect.gen(function* () {
        yield* ensureMigrated;
        const index = yield* readIndex;
        yield* Effect.forEach(
          index.accounts,
          (account) => deleteKeyring(keychainAccount(account)),
          {
            discard: true,
          },
        );
        yield* deleteKeyring(LEGACY_KEYCHAIN_ACCOUNT);
        yield* removeFile(sessionsFile);
        yield* removeFile(legacySessionFile);
        yield* removeFile(indexFile);
      }),

      listAccounts: Effect.gen(function* () {
        yield* ensureMigrated;
        return yield* readIndex;
      }),

      setActiveAccount: (username: string) =>
        Effect.gen(function* () {
          yield* ensureMigrated;
          yield* indexAccount(normalizeAppleUsername(username), { activate: true });
        }).pipe(
          Effect.mapError(
            (cause) =>
              new AppleAuthError({
                message: `Failed to switch Apple account: ${formatCause(cause)}`,
              }),
          ),
        ),

      loadLastUsername: Effect.gen(function* () {
        const content = yield* readFileOrNull(usernameFile);
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
        writeSecureFile(usernameFile, { username }).pipe(
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
