import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "./context";
import { generateDownloadUrl, generateUploadUrl } from "./signed-url";

export interface StoredBuildBlob {
  readonly body: ReadableStream | null;
  readonly size: number;
  readonly contentType: string | null;
  readonly uploaded: Date | null;
}

export interface BuildObjectListing {
  readonly key: string;
  readonly uploaded: Date;
}

export interface BuildRuntimeService {
  readonly createUploadUrl: (params: {
    readonly key: string;
    readonly expiresIn: number;
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
  readonly getObject: (params: { readonly key: string }) => Effect.Effect<StoredBuildBlob | null>;
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
}

export class BuildRuntime extends Context.Tag("server/BuildRuntime")<
  BuildRuntime,
  BuildRuntimeService
>() {}

const toStoredBuildBlob = (object: R2ObjectBody): StoredBuildBlob => ({
  body: object.body,
  size: object.size,
  contentType: object.httpMetadata?.contentType ?? null,
  uploaded: object.uploaded,
});

export const BuildRuntimeLive = Layer.succeed(BuildRuntime, {
  createUploadUrl: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      return yield* Effect.promise(async () =>
        generateUploadUrl(env, params.key, params.expiresIn),
      );
    }),

  createDownloadUrl: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      return yield* Effect.promise(async () =>
        generateDownloadUrl(env, params.key, params.expiresIn),
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
