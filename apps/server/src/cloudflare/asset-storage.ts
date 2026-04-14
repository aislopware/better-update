import { Context, Effect, Layer } from "effect";

import { toBase64 } from "../lib/base64";
import { cloudflareEnv } from "./context";
import { generateUploadUrl } from "./signed-url";

export interface StoredBlob {
  readonly body: ReadableStream | null;
  readonly size: number;
  readonly etag: string | null;
  readonly contentType: string | null;
  readonly uploaded: Date | null;
  readonly checksumSha256Base64: string | null;
}

export interface StoredBlobMetadata {
  readonly size: number;
  readonly etag: string | null;
  readonly contentType: string | null;
  readonly uploaded: Date | null;
  readonly checksumSha256Base64: string | null;
}

export interface AssetStorageService {
  readonly createUploadUrl: (params: {
    readonly key: string;
    readonly contentType: string;
    readonly checksumSha256Base64: string;
    readonly expiresIn: number;
  }) => Effect.Effect<string>;
  readonly headObject: (params: {
    readonly key: string;
  }) => Effect.Effect<StoredBlobMetadata | null>;
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

const toChecksumSha256Base64 = (checksums: unknown): string | null => {
  if (typeof checksums !== "object" || checksums === null) {
    return null;
  }

  const { sha256 } = checksums as { readonly sha256?: unknown };
  return sha256 instanceof Uint8Array || sha256 instanceof ArrayBuffer ? toBase64(sha256) : null;
};

const toStoredBlob = (object: R2ObjectBody): StoredBlob => ({
  body: object.body,
  size: object.size,
  etag: object.httpEtag,
  contentType: object.httpMetadata?.contentType ?? null,
  uploaded: object.uploaded,
  checksumSha256Base64: toChecksumSha256Base64(Reflect.get(object, "checksums")),
});

const toStoredBlobMetadata = (object: R2Object): StoredBlobMetadata => ({
  size: object.size,
  etag: object.httpEtag,
  contentType: object.httpMetadata?.contentType ?? null,
  uploaded: object.uploaded,
  checksumSha256Base64: toChecksumSha256Base64(Reflect.get(object, "checksums")),
});

export const AssetStorageLive = Layer.succeed(AssetStorage, {
  createUploadUrl: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      return yield* Effect.promise(async () =>
        generateUploadUrl(env, {
          bucketName: env.ASSETS_BUCKET_NAME ?? "better-update-assets",
          key: params.key,
          contentType: params.contentType,
          checksumSha256Base64: params.checksumSha256Base64,
          expiresIn: params.expiresIn,
        }),
      );
    }),

  headObject: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const object = yield* Effect.promise(async () => env.ASSETS_BUCKET.head(params.key));
      return object ? toStoredBlobMetadata(object) : null;
    }),

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
