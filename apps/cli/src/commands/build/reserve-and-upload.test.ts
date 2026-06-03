import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import { FileSystem, HttpClient, HttpClientResponse } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Data, Effect, Exit, Layer } from "effect";

import {
  CompleteError,
  PresignedUrlExpiredError,
  ReserveError,
  UploadFailedError,
} from "../../lib/exit-codes";
import { failureError } from "../../lib/test-utils";
import { PresignedUploadClientLive } from "../../services/presigned-upload";
import { reserveAndUpload } from "./reserve-and-upload";

import type { ApiClient } from "../../services/api-client";

class ApiStubError extends Data.TaggedError("ApiStubError")<{
  message: string;
  cause?: unknown;
}> {}

// ── helpers ───────────────────────────────────────────────────────

interface ApiStubOptions {
  readonly reserve?: (args: { payload: Record<string, unknown> }) => Effect.Effect<
    {
      id: string;
      uploadMode: "single";
      uploadUrl: string;
      uploadExpiresAt: string;
      uploadHeaders: Record<string, string>;
    },
    unknown
  >;
  readonly complete?: (args: {
    path: { id: string };
    payload: { sha256: string; byteSize: number };
  }) => Effect.Effect<{ id: string; artifact: unknown }, unknown>;
}

const makeApi = (opts: ApiStubOptions): ApiClient =>
  ({
    builds: {
      reserve:
        opts.reserve ??
        (() =>
          Effect.succeed({
            id: "build_1",
            uploadMode: "single" as const,
            uploadUrl: "https://example.com/upload",
            uploadExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            uploadHeaders: {
              "content-type": "application/octet-stream",
              "x-amz-checksum-sha256": "checksum",
            },
          })),
      complete:
        opts.complete ??
        (() =>
          Effect.succeed({
            id: "build_1",
            artifact: {
              r2Key: "r2/build_1",
              format: "ipa",
              contentType: "application/octet-stream",
              byteSize: 11,
              sha256: "deadbeef",
            },
          })),
    },
  }) as unknown as ApiClient;

const makeHttpClientLayer = (
  respond: () => globalThis.Response,
): Layer.Layer<HttpClient.HttpClient> =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => Effect.sync(() => HttpClientResponse.fromWeb(request, respond()))),
  );

const makePresignedUploadLayer = (
  fileSystemLayer: Layer.Layer<FileSystem.FileSystem>,
  respond: () => globalThis.Response,
) =>
  PresignedUploadClientLive.pipe(
    Layer.provide(Layer.mergeAll(fileSystemLayer, makeHttpClientLayer(respond))),
  );

const okResponse = () => new Response(null, { status: 200 });

const withTempFile = (bytes: Buffer): { path: string; dispose: () => void } => {
  const dir = mkdtempSync(nodePath.join(tmpdir(), "reserve-test-"));
  const filePath = nodePath.join(dir, "artifact.bin");
  writeFileSync(filePath, bytes);
  return {
    path: filePath,
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
};

const baseInput = (artifactPath: string) => ({
  projectId: "proj_1",
  target: {
    platform: "ios" as const,
    distribution: "app-store" as const,
    artifactFormat: "ipa" as const,
  },
  profileName: "production",
  runtimeVersion: "1.2.3",
  appVersion: "1.2.0",
  buildNumber: "42",
  bundleId: "com.example.app",
  gitContext: { ref: "main", commit: "abc123", dirty: false },
  message: "test build",
  artifactPath,
  sha256: "deadbeef",
  byteSize: 11,
});

// ── tests ─────────────────────────────────────────────────────────

describe(reserveAndUpload, () => {
  it.effect("happy path: reserves, uploads, completes", () =>
    Effect.gen(function* () {
      const file = withTempFile(Buffer.from("hello world"));
      let reservePayload: Record<string, unknown> | undefined;
      let completePath: { id: string } | undefined;

      const api = makeApi({
        reserve: ({ payload }) => {
          reservePayload = payload;
          return Effect.succeed({
            id: "build_123",
            uploadMode: "single" as const,
            uploadUrl: "https://example.com/upload",
            uploadExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            uploadHeaders: {
              "content-type": "application/octet-stream",
              "x-amz-checksum-sha256": "checksum",
            },
          });
        },
        complete: ({ path, payload }) => {
          completePath = path;
          return Effect.succeed({
            id: path.id,
            artifact: {
              r2Key: `r2/${path.id}`,
              format: "ipa",
              contentType: "application/octet-stream",
              byteSize: payload.byteSize,
              sha256: payload.sha256,
            },
          });
        },
      });

      const result = yield* reserveAndUpload(api, baseInput(file.path)).pipe(
        Effect.provide(makePresignedUploadLayer(NodeFileSystem.layer, okResponse)),
        Effect.ensuring(Effect.sync(file.dispose)),
      );

      expect(result.id).toBe("build_123");
      expect(result.status).toBe("uploaded");
      expect(reservePayload?.["projectId"]).toBe("proj_1");
      expect(reservePayload?.["platform"]).toBe("ios");
      expect(reservePayload?.["profile"]).toBe("production");
      expect(reservePayload?.["distribution"]).toBe("app-store");
      expect(reservePayload?.["runtimeVersion"]).toBe("1.2.3");
      expect(reservePayload?.["gitRef"]).toBe("main");
      expect(reservePayload?.["gitCommit"]).toBe("abc123");
      expect(reservePayload?.["gitDirty"]).toBe(false);
      expect(reservePayload?.["bundleId"]).toBe("com.example.app");
      expect(reservePayload?.["sha256"]).toBe("deadbeef");
      expect(reservePayload?.["byteSize"]).toBe(11);
      expect(completePath?.id).toBe("build_123");
    }),
  );

  it.effect("fails with ReserveError when reserve endpoint fails", () =>
    Effect.gen(function* () {
      const api = makeApi({
        reserve: () => Effect.fail(new ApiStubError({ message: "server down" })),
      });
      const exit = yield* reserveAndUpload(api, baseInput("/dev/null")).pipe(
        Effect.provide(makePresignedUploadLayer(FileSystem.layerNoop({}), okResponse)),
        Effect.exit,
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = failureError(exit);
        expect(error).toBeInstanceOf(ReserveError);
      }
    }),
  );

  it.effect("fails with PresignedUrlExpiredError when upload URL expired", () =>
    Effect.gen(function* () {
      const api = makeApi({
        reserve: () =>
          Effect.succeed({
            id: "build_1",
            uploadMode: "single" as const,
            uploadUrl: "https://example.com/upload",
            uploadExpiresAt: new Date(Date.now() - 1000).toISOString(),
            uploadHeaders: {
              "content-type": "application/octet-stream",
              "x-amz-checksum-sha256": "checksum",
            },
          }),
      });
      const exit = yield* reserveAndUpload(api, baseInput("/dev/null")).pipe(
        Effect.provide(makePresignedUploadLayer(FileSystem.layerNoop({}), okResponse)),
        Effect.exit,
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = failureError(exit);
        expect(error).toBeInstanceOf(PresignedUrlExpiredError);
      }
    }),
  );

  it.effect("fails with UploadFailedError when PUT returns 403", () =>
    Effect.gen(function* () {
      const file = withTempFile(Buffer.from("hello world"));
      const api = makeApi({});
      const exit = yield* reserveAndUpload(api, baseInput(file.path)).pipe(
        Effect.provide(
          makePresignedUploadLayer(
            NodeFileSystem.layer,
            () => new Response("AccessDenied", { status: 403, statusText: "Forbidden" }),
          ),
        ),
        Effect.ensuring(Effect.sync(file.dispose)),
        Effect.exit,
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = failureError(exit);
        expect(error).toBeInstanceOf(UploadFailedError);
      }
    }),
  );

  it.effect("fails with CompleteError when complete endpoint fails", () =>
    Effect.gen(function* () {
      const file = withTempFile(Buffer.from("hello world"));
      const api = makeApi({
        complete: () => Effect.fail(new ApiStubError({ message: "db error" })),
      });
      const exit = yield* reserveAndUpload(api, baseInput(file.path)).pipe(
        Effect.provide(makePresignedUploadLayer(NodeFileSystem.layer, okResponse)),
        Effect.ensuring(Effect.sync(file.dispose)),
        Effect.exit,
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = failureError(exit);
        expect(error).toBeInstanceOf(CompleteError);
      }
    }),
  );
});
