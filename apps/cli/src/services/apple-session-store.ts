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

        if (!content) {
          return null;
        }

        const parsed = safeJsonParse(content);
        if (!isRecord(parsed)) {
          return null;
        }

        if (
          typeof parsed["teamId"] !== "string" ||
          typeof parsed["username"] !== "string" ||
          !parsed["cookies"]
        ) {
          return null;
        }

        const providerIdRaw = parsed["providerId"];
        const hasProviderId = typeof providerIdRaw === "number" && Number.isInteger(providerIdRaw);

        // eslint-disable-next-line typescript/no-unsafe-type-assertion, typescript/no-unsafe-assignment -- AppleSessionCookies is an opaque cookies payload from @expo/apple-utils; round-tripped verbatim from disk
        const cookies = parsed["cookies"] as AppleSessionCookies;

        const session: SerializedAppleSession = {
          // eslint-disable-next-line typescript/no-unsafe-assignment -- see disable on the `cookies` declaration above; same opaque value
          cookies,
          teamId: parsed["teamId"],
          username: parsed["username"],
          ...(hasProviderId ? { providerId: providerIdRaw } : {}),
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
    };
  }),
);
