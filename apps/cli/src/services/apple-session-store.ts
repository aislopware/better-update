import path from "node:path";

import { FileSystem } from "@effect/platform";
import { Context, Effect, Layer } from "effect";

import { CliRuntime } from "./cli-runtime";

export interface SerializedAppleSession {
  readonly cookies: unknown;
  readonly teamId: string;
  readonly username: string;
}

export class AppleSessionStore extends Context.Tag("cli/AppleSessionStore")<
  AppleSessionStore,
  {
    readonly loadSession: Effect.Effect<SerializedAppleSession | null>;
    readonly saveSession: (session: SerializedAppleSession) => Effect.Effect<void>;
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

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(content) as Record<string, unknown>;
        } catch {
          return null;
        }

        if (
          typeof parsed["teamId"] !== "string" ||
          typeof parsed["username"] !== "string" ||
          !parsed["cookies"]
        ) {
          return null;
        }

        return {
          cookies: parsed["cookies"],
          teamId: parsed["teamId"] as string,
          username: parsed["username"] as string,
        } satisfies SerializedAppleSession;
      }),

      saveSession: (session: SerializedAppleSession) =>
        Effect.gen(function* () {
          yield* fs.makeDirectory(sessionDir, { recursive: true });
          yield* fs.chmod(sessionDir, 0o700);
          yield* fs.writeFileString(sessionFile, `${JSON.stringify(session, null, 2)}\n`);
          yield* fs.chmod(sessionFile, 0o600);
        }).pipe(Effect.orDie),

      clearSession: fs.remove(sessionFile).pipe(Effect.catchAll(() => Effect.void)),
    };
  }),
);
