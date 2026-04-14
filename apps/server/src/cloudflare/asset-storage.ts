import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "./context";

export interface StoredBlob {
  readonly body: ReadableStream | null;
  readonly size: number;
  readonly etag: string | null;
  readonly contentType: string | null;
  readonly uploaded: Date | null;
}

export interface AssetStorageService {
  readonly getObject: (params: { readonly key: string }) => Effect.Effect<StoredBlob | null>;
  readonly putObject: (params: {
    readonly key: string;
    readonly body: ReadableStream | ArrayBuffer | ArrayBufferView | Uint8Array;
    readonly contentType: string;
  }) => Effect.Effect<void>;
  readonly deleteObjects: (params: { readonly keys: readonly string[] }) => Effect.Effect<void>;
}

export class AssetStorage extends Context.Tag("server/AssetStorage")<
  AssetStorage,
  AssetStorageService
>() {}

const toStoredBlob = (object: R2ObjectBody): StoredBlob => ({
  body: object.body,
  size: object.size,
  etag: object.httpEtag,
  contentType: object.httpMetadata?.contentType ?? null,
  uploaded: object.uploaded,
});

export const AssetStorageLive = Layer.succeed(AssetStorage, {
  getObject: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const object = yield* Effect.promise(async () => env.ASSETS_BUCKET.get(params.key));
      return object ? toStoredBlob(object) : null;
    }),

  putObject: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      yield* Effect.promise(async () =>
        env.ASSETS_BUCKET.put(params.key, params.body, {
          httpMetadata: { contentType: params.contentType },
        }),
      );
    }),

  deleteObjects: (params) =>
    Effect.gen(function* () {
      if (params.keys.length === 0) {
        return;
      }

      const env = yield* cloudflareEnv;
      yield* Effect.promise(async () => env.ASSETS_BUCKET.delete([...params.keys]));
    }),
});
