import { Context, Effect, Layer } from "effect";

import { NotFound } from "../errors";
import { r2Operation } from "../lib/r2-helpers";
import { cloudflareEnv } from "./context";

export interface CredentialArtifactsService {
  readonly get: (r2Key: string, label: string) => Effect.Effect<Uint8Array, NotFound>;
  readonly put: (r2Key: string, bytes: Uint8Array) => Effect.Effect<void>;
  readonly delete: (r2Key: string) => Effect.Effect<void>;
}

export class CredentialArtifacts extends Context.Tag("api/CredentialArtifacts")<
  CredentialArtifacts,
  CredentialArtifactsService
>() {}

export const CredentialArtifactsLive = Layer.succeed(CredentialArtifacts, {
  get: (r2Key, label) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const blob = yield* r2Operation(async () => env.CREDENTIAL_ARTIFACTS.get(r2Key));
      if (blob === null) {
        return yield* Effect.fail(
          new NotFound({ message: `${label} artifact missing in object storage` }),
        );
      }
      return new Uint8Array(yield* r2Operation(async () => blob.arrayBuffer()));
    }),
  put: (r2Key, bytes) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      yield* r2Operation(async () => env.CREDENTIAL_ARTIFACTS.put(r2Key, bytes));
    }),
  delete: (r2Key) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      yield* r2Operation(async () => env.CREDENTIAL_ARTIFACTS.delete(r2Key));
    }),
});
