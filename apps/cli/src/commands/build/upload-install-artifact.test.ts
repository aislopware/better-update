import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import { NodeFileSystem } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Data, Effect, Layer } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import { makeOutputModeLayer } from "../../lib/output-mode";
import { PresignedUploadClientLive } from "../../services/presigned-upload";
import { uploadInstallArtifact } from "./upload-install-artifact";

import type { ApiClient } from "../../services/api-client";

class ApiStubError extends Data.TaggedError("ApiStubError")<{ message: string }> {}

const reservation = () => ({
  uploadUrl: "https://example.com/upload",
  uploadExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  uploadHeaders: { "content-type": "application/vnd.android.package-archive" },
});

interface Call {
  readonly params: { id: string };
  readonly payload: { sha256: string; byteSize: number };
}

const makeApi = (opts: {
  readonly reserve?: () => Effect.Effect<ReturnType<typeof reservation>, unknown>;
  readonly onComplete?: (args: Call) => void;
}): ApiClient =>
  ({
    builds: {
      reserveInstallArtifact: opts.reserve ?? (() => Effect.succeed(reservation())),
      completeInstallArtifact: (args: Call) => {
        opts.onComplete?.(args);
        return Effect.succeed({});
      },
    },
  }) as unknown as ApiClient;

const testLayer = Layer.mergeAll(
  NodeFileSystem.layer,
  makeOutputModeLayer(false),
  PresignedUploadClientLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        NodeFileSystem.layer,
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) =>
            Effect.sync(() =>
              HttpClientResponse.fromWeb(request, new Response(null, { status: 200 })),
            ),
          ),
        ),
      ),
    ),
  ),
);

const withTempApk = () => {
  const dir = mkdtempSync(nodePath.join(tmpdir(), "install-upload-test-"));
  const apkPath = nodePath.join(dir, "universal.apk");
  writeFileSync(apkPath, "not really an apk");
  return { apkPath, dispose: () => rmSync(dir, { recursive: true, force: true }) };
};

describe(uploadInstallArtifact, () => {
  it.effect("reserves, uploads and completes with the artifact's own digest", () =>
    Effect.gen(function* () {
      const files = withTempApk();
      const completed: Call[] = [];
      const api = makeApi({ onComplete: (args) => completed.push(args) });

      const stored = yield* uploadInstallArtifact(api, {
        buildId: "build_1",
        artifact: { path: files.apkPath, sha256: "ab".repeat(32), byteSize: 17 },
      }).pipe(Effect.provide(testLayer), Effect.ensuring(Effect.sync(files.dispose)));

      expect(stored).toBe(true);
      expect(completed).toStrictEqual([
        { params: { id: "build_1" }, payload: { sha256: "ab".repeat(32), byteSize: 17 } },
      ]);
    }),
  );

  it.effect("is best-effort: a server failure reports false instead of failing", () =>
    Effect.gen(function* () {
      const files = withTempApk();
      const api = makeApi({
        reserve: () => Effect.fail(new ApiStubError({ message: "server down" })),
      });

      const stored = yield* uploadInstallArtifact(api, {
        buildId: "build_1",
        artifact: { path: files.apkPath, sha256: "ab".repeat(32), byteSize: 17 },
      }).pipe(Effect.provide(testLayer), Effect.ensuring(Effect.sync(files.dispose)));

      expect(stored).toBe(false);
    }),
  );
});
