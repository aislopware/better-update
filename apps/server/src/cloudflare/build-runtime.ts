import { Context, Effect, Layer, Stream } from "effect";

import { sliceReadChunk } from "../lib/http-range";
import { toDbNull } from "../lib/nullable";
import { r2Operation, toChecksumSha256Base64 } from "../lib/r2-helpers";
import { cloudflareEnv } from "./context";
import { r2Checksums, r2ListCursor } from "./r2-accessors";
import { generateDownloadUrl, generateUploadUrl } from "./signed-url";

import type { ByteRange, ObjectRead } from "../lib/http-range";

export interface StoredBuildBlob {
  readonly body: ReadableStream | null;
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
    /** Force `attachment; filename=…` downloads for browser-opened URLs. */
    readonly contentDisposition?: string;
  }) => Effect.Effect<string>;
  readonly putReservation: (params: {
    readonly id: string;
    readonly value: string;
    readonly ttlSeconds: number;
  }) => Effect.Effect<void>;
  readonly getReservation: (params: { readonly id: string }) => Effect.Effect<string | null>;
  readonly deleteReservation: (params: { readonly id: string }) => Effect.Effect<void>;
  readonly getObject: (params: { readonly key: string }) => Effect.Effect<StoredBuildBlob | null>;
  readonly getObjectBytes: (params: { readonly key: string }) => Effect.Effect<Uint8Array | null>;
  /** One byte range of an object (`body` holds just those bytes). */
  readonly getObjectRange: (params: {
    readonly key: string;
    readonly range: ByteRange;
  }) => Effect.Effect<StoredBuildBlob | null>;
  /**
   * The bytes of several ranges of an object as one stream, each between its
   * prefix and suffix — a `multipart/byteranges` body. Each read is one
   * ranged R2 get, made when the stream reaches it.
   */
  readonly streamObjectReads: (params: {
    readonly key: string;
    readonly reads: readonly ObjectRead[];
  }) => Effect.Effect<ReadableStream<Uint8Array>>;
  readonly putObject: (params: {
    readonly key: string;
    readonly body: ReadableStream | ArrayBuffer | ArrayBufferView | Uint8Array;
    readonly contentType: string;
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
  /** What every project's APT repository signing key derives from; null leaves APT off. */
  readonly getAptSigningSecret: Effect.Effect<string | null>;
}

export class BuildRuntime extends Context.Service<BuildRuntime, BuildRuntimeService>()(
  "server/BuildRuntime",
) {}

const toStoredBuildBlob = (object: R2ObjectBody): StoredBuildBlob => ({
  body: object.body,
  size: object.size,
  contentType: toDbNull(object.httpMetadata?.contentType),
  uploaded: object.uploaded,
  checksumSha256Base64: toChecksumSha256Base64(r2Checksums(object)),
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
          ...(params.contentDisposition ? { contentDisposition: params.contentDisposition } : {}),
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

  getObject: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const object = yield* r2Operation(async () => env.BUILD_BUCKET.get(params.key));
      return object ? toStoredBuildBlob(object) : null;
    }),

  getObjectBytes: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const object = yield* r2Operation(async () => env.BUILD_BUCKET.get(params.key));
      if (!object) {
        return null;
      }
      return yield* r2Operation(async () => new Uint8Array(await object.arrayBuffer()));
    }),

  getObjectRange: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const object = yield* r2Operation(async () =>
        env.BUILD_BUCKET.get(params.key, { range: params.range }),
      );
      return object ? toStoredBuildBlob(object) : null;
    }),

  streamObjectReads: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const readStream = (read: ObjectRead) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const object = yield* r2Operation(async () =>
              env.BUILD_BUCKET.get(params.key, {
                range: { offset: read.offset, length: read.length },
              }),
            );
            if (object === null) {
              return yield* Effect.die(new Error(`R2 object ${params.key} is gone`));
            }
            return Stream.fromReadableStream<Uint8Array, Error>({
              evaluate: () => object.body,
              onError: (cause) => new Error("R2 read failed", { cause }),
            }).pipe(
              Stream.mapAccum(
                () => read.offset,
                (offset, chunk) =>
                  [offset + chunk.length, sliceReadChunk(read, offset, chunk)] as const,
              ),
            );
          }),
        );
      return Stream.fromIterable(params.reads).pipe(
        Stream.flatMap(readStream),
        Stream.toReadableStream(),
      );
    }),

  putObject: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      yield* r2Operation(async () =>
        env.BUILD_BUCKET.put(params.key, params.body, {
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
      yield* r2Operation(async () => env.BUILD_BUCKET.delete([...params.keys]));
    }),

  listObjects: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const listed = yield* r2Operation(async () =>
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
        cursor: r2ListCursor(listed),
      };
    }),

  getInstallTokenSecret: Effect.gen(function* () {
    const env = yield* cloudflareEnv;
    return env.INSTALL_TOKEN_SECRET || null;
  }),

  getAptSigningSecret: Effect.gen(function* () {
    const env = yield* cloudflareEnv;
    return env.APT_SIGNING_SECRET || null;
  }),
});
