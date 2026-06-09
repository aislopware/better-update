import { toDbNull } from "@better-update/type-guards";
import { Context, Effect, Layer } from "effect";

import { kyselyDb } from "../cloudflare/db";

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
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("user")
          .select(["id", "name", "email"])
          .where("id", "=", id)
          .executeTakeFirst(),
      );
      return toDbNull(row);
    }),
  findOrganizationById: (id: string) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("organization")
          .select(["id", "name", "slug"])
          .where("id", "=", id)
          .executeTakeFirst(),
      );
      return toDbNull(row);
    }),
});
