import path from "node:path";

import { safeJsonParse } from "@better-update/safe-json";
import { FileSystem } from "@effect/platform";
import { Context, Effect, Layer } from "effect";

import type * as AppleUtils from "@expo/apple-utils";

import { AppleAuthError } from "../lib/exit-codes";
import { formatCause } from "../lib/format-error";
import { CliRuntime } from "./cli-runtime";

// The cookies payload accepted by @expo/apple-utils Auth.loginWithCookiesAsync.
// Derived structurally so we don't depend on the un-exported `CookiesJSON` alias.
export type AppleSessionCookies = Parameters<
  typeof AppleUtils.Auth.loginWithCookiesAsync
>[0]["cookies"];

export interface SerializedAppleSession {
  readonly cookies: AppleSessionCookies;
  readonly teamId: string;
  readonly username: string;
  readonly providerId?: number;
}

export class AppleSessionStore extends Context.Tag("cli/AppleSessionStore")<
  AppleSessionStore,
  {
    readonly loadSession: Effect.Effect<SerializedAppleSession | null>;
    readonly saveSession: (session: SerializedAppleSession) => Effect.Effect<void, AppleAuthError>;
    readonly clearSession: Effect.Effect<void>;
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

    return {
      loadSession: Effect.gen(function* () {
        const content = yield* fs
          .readFileString(sessionFile)
          .pipe(Effect.catchAll(() => Effect.succeed(null)));

        if (!content) return null;

        const parsed = safeJsonParse(content);
        if (typeof parsed !== "object" || parsed === null) return null;

        const record = parsed as Record<string, unknown>;
        if (
          typeof record["teamId"] !== "string" ||
          typeof record["username"] !== "string" ||
          !record["cookies"]
        ) {
          return null;
        }

        const providerIdRaw = record["providerId"];
        const hasProviderId = typeof providerIdRaw === "number" && Number.isInteger(providerIdRaw);

        return {
          cookies: record["cookies"] as AppleSessionCookies,
          teamId: record["teamId"],
          username: record["username"],
          ...(hasProviderId ? { providerId: providerIdRaw } : {}),
        } satisfies SerializedAppleSession;
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
    };
  }),
);
