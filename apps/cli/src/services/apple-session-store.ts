import path from "node:path";

import { safeJsonParse } from "@better-update/safe-json";
import { isRecord } from "@better-update/type-guards";
import { FileSystem } from "@effect/platform";
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

export const AppleSessionStoreLive = Layer.effect(
  AppleSessionStore,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const runtime = yield* CliRuntime;
    const homeDirectory = yield* runtime.homeDirectory;
    const sessionDir = path.join(homeDirectory, ".better-update");
    const sessionFile = path.join(sessionDir, "apple-session.json");
    const usernameFile = path.join(sessionDir, "apple-username.json");

    return {
      loadSession: Effect.gen(function* () {
        const content = yield* fs
          .readFileString(sessionFile)
          .pipe(Effect.catchAll(() => Effect.succeed(null)));

        if (!content) {
          return null;
        }

        const parsed = safeJsonParse(content);
        if (!isRecord(parsed)) {
          return null;
        }

        if (typeof parsed["username"] !== "string" || !parsed["cookies"]) {
          return null;
        }

        // eslint-disable-next-line typescript/no-unsafe-type-assertion, typescript/no-unsafe-assignment -- AppleSessionCookies is an opaque cookies payload from @expo/apple-utils; round-tripped verbatim from disk
        const cookies = parsed["cookies"] as AppleSessionCookies;

        const session: SerializedAppleSession = {
          // eslint-disable-next-line typescript/no-unsafe-assignment -- see disable on the `cookies` declaration above; same opaque value
          cookies,
          username: parsed["username"],
        };
        return session;
      }),

      saveSession: (session: SerializedAppleSession) =>
        Effect.gen(function* () {
          yield* fs.makeDirectory(sessionDir, { recursive: true });
          yield* fs.chmod(sessionDir, 0o700);
          yield* fs.writeFileString(sessionFile, `${JSON.stringify(session, null, 2)}\n`);
          yield* fs.chmod(sessionFile, 0o600);
        }).pipe(
          Effect.mapError(
            (cause) =>
              new AppleAuthError({
                message: `Failed to save Apple session: ${formatCause(cause)}`,
              }),
          ),
        ),

      clearSession: fs.remove(sessionFile).pipe(Effect.catchAll(() => Effect.void)),

      loadLastUsername: Effect.gen(function* () {
        const content = yield* fs
          .readFileString(usernameFile)
          .pipe(Effect.catchAll(() => Effect.succeed(null)));
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
