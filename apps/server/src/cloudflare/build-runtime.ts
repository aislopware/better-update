import { Context, Effect, Layer } from "effect";

import { toBase64 } from "../lib/base64";
import { cloudflareEnv } from "./context";
import { copyObject, generateDownloadUrl, generateUploadUrl } from "./signed-url";

export interface StoredBuildBlob {
  readonly body: ReadableStream | null;
  readonly size: number;
  readonly contentType: string | null;
  readonly uploaded: Date | null;
  readonly checksumSha256Base64: string | null;
}

export interface StoredBuildObjectMetadata {
  readonly size: number;
  readonly contentType: string | null;
  readonly uploaded: Date | null;
  readonly checksumSha256Base64: string | null;
}

export interface BuildObjectListing {
  readonly key: string;
  readonly uploaded: Date;
}

export interface BuildRuntimeService {
  readonly createUploadUrl: (params: {
    readonly key: string;
    readonly expiresIn: number;
    readonly contentType: string;
    readonly checksumSha256Base64: string;
  }) => Effect.Effect<string>;
  readonly createDownloadUrl: (params: {
    readonly key: string;
    readonly expiresIn: number;
  }) => Effect.Effect<string>;
  readonly putReservation: (params: {
    readonly id: string;
    readonly value: string;
    readonly ttlSeconds: number;
  }) => Effect.Effect<void>;
  readonly getReservation: (params: { readonly id: string }) => Effect.Effect<string | null>;
  readonly deleteReservation: (params: { readonly id: string }) => Effect.Effect<void>;
  readonly headObject: (params: {
    readonly key: string;
  }) => Effect.Effect<StoredBuildObjectMetadata | null>;
  readonly getObject: (params: { readonly key: string }) => Effect.Effect<StoredBuildBlob | null>;
  readonly putObject: (params: {
    readonly key: string;
    readonly body: ReadableStream | ArrayBuffer | ArrayBufferView | Uint8Array;
    readonly contentType: string;
  }) => Effect.Effect<void>;
  readonly copyObject: (params: {
    readonly sourceKey: string;
    readonly destinationKey: string;
  }) => Effect.Effect<void>;
  readonly deleteObjects: (params: { readonly keys: readonly string[] }) => Effect.Effect<void>;
  readonly listObjects: (params: {
    readonly prefix: string;
    readonly cursor?: string;
  }) => Effect.Effect<{
    readonly objects: readonly BuildObjectListing[];
    readonly truncated: boolean;
    readonly cursor: string | undefined;
  }>;
  readonly getInstallTokenSecret: Effect.Effect<string | null>;
}

export class BuildRuntime extends Context.Tag("server/BuildRuntime")<
  BuildRuntime,
  BuildRuntimeService
>() {}

const toChecksumSha256Base64 = (checksums: unknown): string | null => {
  if (typeof checksums !== "object" || checksums === null) {
    return null;
  }

  const { sha256 } = checksums as { readonly sha256?: unknown };
  return sha256 instanceof Uint8Array || sha256 instanceof ArrayBuffer ? toBase64(sha256) : null;
};

const toStoredBuildBlob = (object: R2ObjectBody): StoredBuildBlob => ({
  body: object.body,
  size: object.size,
  contentType: object.httpMetadata?.contentType ?? null,
  uploaded: object.uploaded,
  checksumSha256Base64: toChecksumSha256Base64(Reflect.get(object, "checksums")),
});

const toStoredBuildObjectMetadata = (object: R2Object): StoredBuildObjectMetadata => ({
  size: object.size,
  contentType: object.httpMetadata?.contentType ?? null,
  uploaded: object.uploaded,
  checksumSha256Base64: toChecksumSha256Base64(Reflect.get(object, "checksums")),
});

export const BuildRuntimeLive = Layer.succeed(BuildRuntime, {
  createUploadUrl: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      return yield* Effect.promise(async () =>
        generateUploadUrl(env, {
          bucketName: env.BUILD_BUCKET_NAME,
          key: params.key,
          contentType: params.contentType,
          checksumSha256Base64: params.checksumSha256Base64,
          expiresIn: params.expiresIn,
        }),
      );
    }),

  createDownloadUrl: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      return yield* Effect.promise(async () =>
        generateDownloadUrl(env, {
          bucketName: env.BUILD_BUCKET_NAME,
          key: params.key,
          expiresIn: params.expiresIn,
        }),
      );
    }),

  putReservation: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      yield* Effect.promise(async () =>
        env.BUILD_RESERVATIONS.put(params.id, params.value, {
          expirationTtl: params.ttlSeconds,
        }),
      );
    }),

  getReservation: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      return yield* Effect.promise(async () => env.BUILD_RESERVATIONS.get(params.id));
    }),

  deleteReservation: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      yield* Effect.promise(async () => env.BUILD_RESERVATIONS.delete(params.id));
    }),

  headObject: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const object = yield* Effect.promise(async () => env.BUILD_BUCKET.head(params.key));
      return object ? toStoredBuildObjectMetadata(object) : null;
    }),

  getObject: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const object = yield* Effect.promise(async () => env.BUILD_BUCKET.get(params.key));
      return object ? toStoredBuildBlob(object) : null;
    }),

  putObject: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      yield* Effect.promise(async () =>
        env.BUILD_BUCKET.put(params.key, params.body, {
          httpMetadata: { contentType: params.contentType },
        }),
      );
    }),

  copyObject: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      yield* Effect.promise(async () =>
        copyObject(env, {
          sourceBucketName: env.BUILD_BUCKET_NAME,
          sourceKey: params.sourceKey,
          destinationBucketName: env.BUILD_BUCKET_NAME,
          destinationKey: params.destinationKey,
        }),
      );
    }),

  deleteObjects: (params) =>
    Effect.gen(function* () {
      if (params.keys.length === 0) {
        return;
      }

      const env = yield* cloudflareEnv;
      yield* Effect.promise(async () => env.BUILD_BUCKET.delete([...params.keys]));
    }),

  listObjects: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const listed = yield* Effect.promise(async () =>
        env.BUILD_BUCKET.list(
          params.cursor
            ? { prefix: params.prefix, cursor: params.cursor }
            : { prefix: params.prefix },
        ),
      );

      return {
        objects: listed.objects.map((object) => ({
          key: object.key,
          uploaded: object.uploaded,
        })),
        truncated: listed.truncated,
        cursor: (() => {
          const nextCursor: unknown = Reflect.get(listed, "cursor");
          return typeof nextCursor === "string" ? nextCursor : undefined;
        })(),
      };
    }),

  getInstallTokenSecret: Effect.gen(function* () {
    const env = yield* cloudflareEnv;
    return env.INSTALL_TOKEN_SECRET || null;
  }),
});
