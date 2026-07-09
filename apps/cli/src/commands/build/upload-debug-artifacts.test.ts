import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import { HttpClient, HttpClientResponse } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Data, Effect, Layer } from "effect";

import { makeOutputModeLayer } from "../../lib/output-mode";
import { PresignedUploadClientLive } from "../../services/presigned-upload";
import { uploadDebugArtifacts } from "./upload-debug-artifacts";

import type { ApiClient } from "../../services/api-client";

class ApiStubError extends Data.TaggedError("ApiStubError")<{ message: string }> {}

const reservation = () => ({
  uploadUrl: "https://example.com/upload",
  uploadExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  uploadHeaders: { "content-type": "application/zip" },
});

interface ReserveCall {
  readonly payload: { type: string; sha256: string; byteSize: number };
}

const makeApi = (opts: {
  readonly reserve?: (args: ReserveCall) => Effect.Effect<ReturnType<typeof reservation>, unknown>;
  readonly onComplete?: (args: ReserveCall) => void;
}): ApiClient =>
  ({
    builds: {
      reserveDebugArtifact: opts.reserve ?? (() => Effect.succeed(reservation())),
      completeDebugArtifact: (args: ReserveCall) => {
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

const withTempFiles = (names: readonly string[]) => {
  const dir = mkdtempSync(nodePath.join(tmpdir(), "debug-upload-test-"));
  const paths = names.map((name) => {
    const filePath = nodePath.join(dir, name);
    writeFileSync(filePath, `content of ${name}`);
    return filePath;
  });
  return { paths, dispose: () => rmSync(dir, { recursive: true, force: true }) };
};

describe(uploadDebugArtifacts, () => {
  it.effect("uploads every captured artifact and reports the stored types", () =>
    Effect.gen(function* () {
      const files = withTempFiles(["dSYMs.zip", "main.jsbundle.map"]);
      const completed: string[] = [];
      const api = makeApi({ onComplete: (args) => completed.push(args.payload.type) });

      const stored = yield* uploadDebugArtifacts(api, {
        buildId: "build_1",
        artifacts: [
          { type: "dsym", path: files.paths[0] ?? "" },
          { type: "js-sourcemap", path: files.paths[1] ?? "" },
        ],
      }).pipe(Effect.provide(testLayer), Effect.ensuring(Effect.sync(files.dispose)));

      expect(stored).toStrictEqual(["dsym", "js-sourcemap"]);
      expect(completed).toStrictEqual(["dsym", "js-sourcemap"]);
    }),
  );

  it.effect("is best-effort: one failing artifact never fails the others", () =>
    Effect.gen(function* () {
      const files = withTempFiles(["dSYMs.zip", "main.jsbundle.map"]);
      const api = makeApi({
        reserve: ({ payload }) =>
          payload.type === "dsym"
            ? Effect.fail(new ApiStubError({ message: "server down" }))
            : Effect.succeed(reservation()),
      });

      const stored = yield* uploadDebugArtifacts(api, {
        buildId: "build_1",
        artifacts: [
          { type: "dsym", path: files.paths[0] ?? "" },
          { type: "js-sourcemap", path: files.paths[1] ?? "" },
        ],
      }).pipe(Effect.provide(testLayer), Effect.ensuring(Effect.sync(files.dispose)));

      expect(stored).toStrictEqual(["js-sourcemap"]);
    }),
  );
});
