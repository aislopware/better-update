import { it } from "@effect/vitest";
import { Effect } from "effect";

import { parsePatchRequest } from "../protocol/patch-negotiation";
import { BundleRepo } from "../repositories/bundle";
import { ManifestRepo } from "../repositories/manifest";
import { resolveBundle } from "./resolve-bundle";

import type { StoredBlob } from "../repositories/bundle";
import type { LaunchAssetRow } from "../repositories/manifest";

const TARGET = "11111111-1111-1111-1111-111111111111";
const BASE_CURRENT = "22222222-2222-2222-2222-222222222222";
const BASE_EMBEDDED = "33333333-3333-3333-3333-333333333333";

const blob = (tag: string): StoredBlob => ({
  body: null,
  size: tag.length,
  etag: tag,
  contentType: "application/octet-stream",
  uploaded: null,
  checksumSha256Base64: null,
});

const launchRow = (runtimeVersion: string): LaunchAssetRow => ({
  hash: "launch-hash",
  r2_key: "assets/launch-hash",
  content_type: "application/octet-stream",
  runtime_version: runtimeVersion,
});

const manifestRepo = (params: { readonly launchAsset: LaunchAssetRow | null }) =>
  ManifestRepo.of({
    findLaunchAssetForUpdate: () => Effect.succeed(params.launchAsset),
    resolveChannel: () => Effect.die("unused"),
    resolveUpdates: () => Effect.die("unused"),
    resolveFullyRolledOutUpdate: () => Effect.die("unused"),
    findUpdateAssets: () => Effect.die("unused"),
  });

const bundleRepo = (params: {
  readonly patchKeys: ReadonlySet<string>;
  readonly fullBundle: StoredBlob | null;
}) =>
  BundleRepo.of({
    getPatch: ({ key }) => Effect.succeed(params.patchKeys.has(key) ? blob(key) : null),
    getFullBundle: () => Effect.succeed(params.fullBundle),
    listObjects: () => Effect.succeed({ objects: [], truncated: false, cursor: undefined }),
    deleteObjects: () => Effect.void,
  });

const headers = (init: Record<string, string>) => new Headers(init);

describe(resolveBundle, () => {
  it.effect("returns not-found when the update id is unknown", () =>
    Effect.gen(function* () {
      const result = yield* resolveBundle({
        request: parsePatchRequest(headers({})),
        projectId: "proj",
        updateId: TARGET,
      }).pipe(
        Effect.provideService(ManifestRepo, manifestRepo({ launchAsset: null })),
        Effect.provideService(BundleRepo, bundleRepo({ patchKeys: new Set(), fullBundle: null })),
      );
      expect(result.kind).toBe("not-found");
    }),
  );

  it.effect("returns not-found when the request runtime version mismatches", () =>
    Effect.gen(function* () {
      const result = yield* resolveBundle({
        request: parsePatchRequest(headers({ "expo-runtime-version": "2.0.0" })),
        projectId: "proj",
        updateId: TARGET,
      }).pipe(
        Effect.provideService(ManifestRepo, manifestRepo({ launchAsset: launchRow("1.0.0") })),
        Effect.provideService(
          BundleRepo,
          bundleRepo({ patchKeys: new Set(), fullBundle: blob("full") }),
        ),
      );
      expect(result.kind).toBe("not-found");
    }),
  );

  it.effect("serves the full bundle when the client does not support bsdiff", () =>
    Effect.gen(function* () {
      const result = yield* resolveBundle({
        request: parsePatchRequest(headers({ "expo-platform": "ios" })),
        projectId: "proj",
        updateId: TARGET,
      }).pipe(
        Effect.provideService(ManifestRepo, manifestRepo({ launchAsset: launchRow("1.0.0") })),
        Effect.provideService(
          BundleRepo,
          bundleRepo({ patchKeys: new Set(), fullBundle: blob("full") }),
        ),
      );
      expect(result.kind).toBe("full");
      if (result.kind === "full") {
        expect(result.blob.etag).toBe("full");
      }
    }),
  );

  it.effect("serves a patch against expo-current-update-id when present", () =>
    Effect.gen(function* () {
      const patchKey = `patches/proj/1.0.0/ios/${BASE_CURRENT}__${TARGET}.bsdiff`;
      const result = yield* resolveBundle({
        request: parsePatchRequest(
          headers({
            "a-im": "bsdiff",
            "expo-platform": "ios",
            "expo-current-update-id": BASE_CURRENT,
            "expo-embedded-update-id": BASE_EMBEDDED,
            "expo-runtime-version": "1.0.0",
          }),
        ),
        projectId: "proj",
        updateId: TARGET,
      }).pipe(
        Effect.provideService(ManifestRepo, manifestRepo({ launchAsset: launchRow("1.0.0") })),
        Effect.provideService(
          BundleRepo,
          bundleRepo({ patchKeys: new Set([patchKey]), fullBundle: blob("full") }),
        ),
      );
      expect(result.kind).toBe("patch");
      if (result.kind === "patch") {
        expect(result.baseUpdateId).toBe(BASE_CURRENT);
      }
    }),
  );

  it.effect("falls back to the embedded base when no current-id patch exists", () =>
    Effect.gen(function* () {
      const embeddedKey = `patches/proj/1.0.0/ios/${BASE_EMBEDDED}__${TARGET}.bsdiff`;
      const result = yield* resolveBundle({
        request: parsePatchRequest(
          headers({
            "a-im": "bsdiff",
            "expo-platform": "ios",
            "expo-current-update-id": BASE_CURRENT,
            "expo-embedded-update-id": BASE_EMBEDDED,
            "expo-runtime-version": "1.0.0",
          }),
        ),
        projectId: "proj",
        updateId: TARGET,
      }).pipe(
        Effect.provideService(ManifestRepo, manifestRepo({ launchAsset: launchRow("1.0.0") })),
        Effect.provideService(
          BundleRepo,
          bundleRepo({ patchKeys: new Set([embeddedKey]), fullBundle: blob("full") }),
        ),
      );
      expect(result.kind).toBe("patch");
      if (result.kind === "patch") {
        expect(result.baseUpdateId).toBe(BASE_EMBEDDED);
      }
    }),
  );

  it.effect("falls back to the full bundle when bsdiff supported but no patch exists", () =>
    Effect.gen(function* () {
      const result = yield* resolveBundle({
        request: parsePatchRequest(
          headers({
            "a-im": "bsdiff",
            "expo-platform": "ios",
            "expo-current-update-id": BASE_CURRENT,
            "expo-runtime-version": "1.0.0",
          }),
        ),
        projectId: "proj",
        updateId: TARGET,
      }).pipe(
        Effect.provideService(ManifestRepo, manifestRepo({ launchAsset: launchRow("1.0.0") })),
        Effect.provideService(
          BundleRepo,
          bundleRepo({ patchKeys: new Set(), fullBundle: blob("full") }),
        ),
      );
      expect(result.kind).toBe("full");
    }),
  );

  it.effect("returns not-found when bsdiff supported, no patch, and full bundle missing", () =>
    Effect.gen(function* () {
      const result = yield* resolveBundle({
        request: parsePatchRequest(
          headers({ "a-im": "bsdiff", "expo-platform": "ios", "expo-runtime-version": "1.0.0" }),
        ),
        projectId: "proj",
        updateId: TARGET,
      }).pipe(
        Effect.provideService(ManifestRepo, manifestRepo({ launchAsset: launchRow("1.0.0") })),
        Effect.provideService(BundleRepo, bundleRepo({ patchKeys: new Set(), fullBundle: null })),
      );
      expect(result.kind).toBe("not-found");
    }),
  );
});
