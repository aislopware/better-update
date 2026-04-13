import { FileSystem } from "@effect/platform";
import { Context, Effect, Layer } from "effect";

import { AuthRequiredError } from "../lib/exit-codes";

export class AuthStore extends Context.Tag("cli/AuthStore")<
  AuthStore,
  {
    readonly getToken: Effect.Effect<string, AuthRequiredError>;
    readonly saveToken: (token: string) => Effect.Effect<void>;
    readonly clearToken: Effect.Effect<void>;
  }
>() {}

const getAuthDir = `${process.env["HOME"]}/.better-update`;
const getAuthFile = `${getAuthDir}/auth.json`;

export const AuthStoreLive = Layer.effect(
  AuthStore,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    return {
      getToken: Effect.gen(function* () {
        const envToken = process.env["BETTER_UPDATE_TOKEN"];
        if (envToken) return envToken;

        const content = yield* fs.readFileString(getAuthFile).pipe(
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
          yield* fs.makeDirectory(getAuthDir, { recursive: true });
          yield* fs.chmod(getAuthDir, 0o700);
          yield* fs.writeFileString(getAuthFile, `${JSON.stringify({ token }, null, 2)}\n`);
          yield* fs.chmod(getAuthFile, 0o600);
        }).pipe(Effect.orDie),

      clearToken: fs.remove(getAuthFile).pipe(Effect.catchAll(() => Effect.void)),
    };
  }),
);
