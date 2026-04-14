import path from "node:path";

import { FileSystem } from "@effect/platform";
import { Context, Effect, Layer } from "effect";

import { AuthRequiredError } from "../lib/exit-codes";
import { CliRuntime } from "./cli-runtime";

export class AuthStore extends Context.Tag("cli/AuthStore")<
  AuthStore,
  {
    readonly getToken: Effect.Effect<string, AuthRequiredError>;
    readonly saveToken: (token: string) => Effect.Effect<void>;
    readonly clearToken: Effect.Effect<void>;
  }
>() {}

export const AuthStoreLive = Layer.effect(
  AuthStore,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const runtime = yield* CliRuntime;
    const homeDirectory = yield* runtime.homeDirectory;
    const authDir = path.join(homeDirectory, ".better-update");
    const authFile = path.join(authDir, "auth.json");

    return {
      getToken: Effect.gen(function* () {
        const envToken = yield* runtime.getEnv("BETTER_UPDATE_TOKEN");
        if (envToken) return envToken;

        const content = yield* fs.readFileString(authFile).pipe(
          Effect.mapError(
            () =>
              new AuthRequiredError({
                message: "Not logged in. Run `better-update login` to authenticate.",
              }),
          ),
        );

        const parsed = yield* Effect.try({
          try: () => JSON.parse(content) as Record<string, unknown>,
          catch: () =>
            new AuthRequiredError({
              message: "Corrupted auth file. Run `better-update login` to re-authenticate.",
            }),
        });
        const token = parsed["token"];
        if (typeof token !== "string") {
          return yield* new AuthRequiredError({
            message: "Invalid auth file. Run `better-update login` to re-authenticate.",
          });
        }

        return token;
      }),

      saveToken: (token: string) =>
        Effect.gen(function* () {
          yield* fs.makeDirectory(authDir, { recursive: true });
          yield* fs.chmod(authDir, 0o700);
          yield* fs.writeFileString(authFile, `${JSON.stringify({ token }, null, 2)}\n`);
          yield* fs.chmod(authFile, 0o600);
        }).pipe(Effect.orDie),

      clearToken: fs.remove(authFile).pipe(Effect.catchAll(() => Effect.void)),
    };
  }),
);
