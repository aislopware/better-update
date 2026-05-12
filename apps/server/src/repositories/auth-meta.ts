import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";

export interface AuthMetaUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

export interface AuthMetaOrganization {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

export interface AuthMetaRepository {
  readonly findUserById: (id: string) => Effect.Effect<AuthMetaUser | null>;
  readonly findOrganizationById: (id: string) => Effect.Effect<AuthMetaOrganization | null>;
}

export class AuthMetaRepo extends Context.Tag("server/AuthMetaRepo")<
  AuthMetaRepo,
  AuthMetaRepository
>() {}

export const AuthMetaRepoLive = Layer.succeed(AuthMetaRepo, {
  findUserById: (id: string) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const row = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT "id", "name", "email" FROM "user" WHERE "id" = ?`)
          .bind(id)
          .first<AuthMetaUser>(),
      );
      return row;
    }),
  findOrganizationById: (id: string) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const row = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT "id", "name", "slug" FROM "organization" WHERE "id" = ?`)
          .bind(id)
          .first<AuthMetaOrganization>(),
      );
      return row;
    }),
});
