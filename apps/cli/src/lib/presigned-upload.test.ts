import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HttpClient, HttpClientResponse, FileSystem } from "@effect/platform";
import { BunFileSystem } from "@effect/platform-bun";
import { it } from "@effect/vitest";
import { Effect, Exit, Layer } from "effect";

import { PresignedUploadClientLive } from "../services/presigned-upload";
import { PresignedUrlExpiredError, UploadFailedError } from "./exit-codes";
import { putToPresignedUrl } from "./presigned-upload";
import { failureError } from "./test-utils";

// ── helpers ───────────────────────────────────────────────────────

const makeHttpClientLayer = (
  respond: () => globalThis.Response,
): Layer.Layer<HttpClient.HttpClient> =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => Effect.sync(() => HttpClientResponse.fromWeb(request, respond()))),
  );

// In-memory noop filesystem for the "expired" branch where the file is never opened.
const noopFsLayer: Layer.Layer<FileSystem.FileSystem> = FileSystem.layerNoop({});

const makePresignedUploadLayer = (
  fileSystemLayer: Layer.Layer<FileSystem.FileSystem>,
  respond: () => globalThis.Response,
) =>
  PresignedUploadClientLive.pipe(
    Layer.provide(Layer.mergeAll(fileSystemLayer, makeHttpClientLayer(respond))),
  );

const withTempFile = (bytes: Buffer): { path: string; dispose: () => void } => {
  const dir = mkdtempSync(join(tmpdir(), "presigned-test-"));
  const filePath = join(dir, "artifact.bin");
  writeFileSync(filePath, bytes);
  return {
    path: filePath,
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
};

const futureExpiry = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();
const pastExpiry = () => new Date(Date.now() - 1000).toISOString();

// ── tests ─────────────────────────────────────────────────────────

describe(putToPresignedUrl, () => {
  it.effect("fails with PresignedUrlExpiredError when expiry is in the past", () =>
    Effect.gen(function* () {
      const exit = yield* putToPresignedUrl({
        url: "https://example.com/upload",
        filePath: "/dev/null",
        byteSize: 0,
        expiresAt: pastExpiry(),
      }).pipe(
        Effect.provide(
          makePresignedUploadLayer(noopFsLayer, () => new Response(null, { status: 200 })),
        ),
        Effect.exit,
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = failureError(exit);
        expect(error).toBeInstanceOf(PresignedUrlExpiredError);
      }
    }),
  );

  it.effect("fails with PresignedUrlExpiredError within 30s safety margin", () =>
    Effect.gen(function* () {
      const inTenSeconds = new Date(Date.now() + 10_000).toISOString();
      const exit = yield* putToPresignedUrl({
        url: "https://example.com/upload",
        filePath: "/dev/null",
        byteSize: 0,
        expiresAt: inTenSeconds,
      }).pipe(
        Effect.provide(
          makePresignedUploadLayer(noopFsLayer, () => new Response(null, { status: 200 })),
        ),
        Effect.exit,
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = failureError(exit);
        expect(error).toBeInstanceOf(PresignedUrlExpiredError);
      }
    }),
  );

  it.effect("succeeds on 2xx response", () =>
    Effect.gen(function* () {
      const file = withTempFile(Buffer.from("hello world"));
      const exit = yield* putToPresignedUrl({
        url: "https://example.com/upload",
        filePath: file.path,
        byteSize: 11,
        expiresAt: futureExpiry(),
      }).pipe(
        Effect.provide(
          makePresignedUploadLayer(BunFileSystem.layer, () => new Response(null, { status: 200 })),
        ),
        Effect.ensuring(Effect.sync(file.dispose)),
        Effect.exit,
      );
      expect(Exit.isSuccess(exit)).toBe(true);
    }),
  );

  it.effect("fails with UploadFailedError on 403 response", () =>
    Effect.gen(function* () {
      const file = withTempFile(Buffer.from("hello world"));
      const exit = yield* putToPresignedUrl({
        url: "https://example.com/upload",
        filePath: file.path,
        byteSize: 11,
        expiresAt: futureExpiry(),
      }).pipe(
        Effect.provide(
          makePresignedUploadLayer(
            BunFileSystem.layer,
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
        expect((error as UploadFailedError).message).toContain("403");
      }
    }),
  );
});
