import { describe, expect, test } from "vitest";

import {
  buildExtensions,
  buildManifest,
  buildRollbackDirectiveBody,
  isValidPatchKey,
  launchBundleUrl,
  patchR2Key,
} from "./index";

describe(buildRollbackDirectiveBody, () => {
  test("encodes a rollback directive with the provided commit time", () => {
    expect(JSON.parse(buildRollbackDirectiveBody("2026-04-14T08:00:00.000Z"))).toEqual({
      type: "rollBackToEmbedded",
      parameters: {
        commitTime: "2026-04-14T08:00:00.000Z",
      },
    });
  });
});

const baseParams = {
  projectId: "proj_1",
  runtimeVersion: "1.0.0",
  platform: "ios",
  fromUpdateId: "AAAA1111-2222-3333-4444-555566667777",
  toUpdateId: "BBBB1111-2222-3333-4444-555566667777",
} as const;

describe(patchR2Key, () => {
  test("emits the patches/ key with lowercased update ids", () => {
    expect(patchR2Key(baseParams)).toBe(
      "patches/proj_1/1.0.0/ios/aaaa1111-2222-3333-4444-555566667777__bbbb1111-2222-3333-4444-555566667777.bsdiff",
    );
  });

  test("is deterministic for identical inputs", () => {
    expect(patchR2Key(baseParams)).toBe(patchR2Key(baseParams));
  });

  test("different from/to ids produce different keys", () => {
    const swapped = { ...baseParams, fromUpdateId: baseParams.toUpdateId };
    expect(patchR2Key(swapped)).not.toBe(patchR2Key(baseParams));
  });
});

describe(isValidPatchKey, () => {
  test("accepts the canonical key for its tuple", () => {
    expect(isValidPatchKey(patchR2Key(baseParams), baseParams)).toBe(true);
  });

  test("rejects a key that does not match the tuple", () => {
    expect(isValidPatchKey("patches/other/1.0.0/ios/a__b.bsdiff", baseParams)).toBe(false);
  });

  test.each([
    ["path separator", { ...baseParams, projectId: "a/b" }],
    ["backslash", { ...baseParams, runtimeVersion: "a\\b" }],
    ["traversal", { ...baseParams, platform: ".." }],
    ["empty segment", { ...baseParams, fromUpdateId: "" }],
    ["null byte", { ...baseParams, toUpdateId: "a\0b" }],
  ])("rejects unsafe %s even when the key matches", (_label, params) => {
    expect(isValidPatchKey(patchR2Key(params), params)).toBe(false);
  });
});

describe(launchBundleUrl, () => {
  test("emits the Worker bundle route", () => {
    expect(
      launchBundleUrl({
        serverBaseUrl: "https://api.example.dev",
        projectId: "proj_1",
        updateId: "update_9",
        hash: "abc123",
      }),
    ).toBe("https://api.example.dev/manifest/proj_1/bundle/update_9/abc123");
  });
});

const baseUpdate = {
  id: "update-1",
  createdAt: "2025-01-01T00:00:00.000Z",
  runtimeVersion: "1.0.0",
  metadata: { branchName: "main" },
  extra: { expoClient: { name: "test-app" } },
};

const launchAsset = {
  key: "bundle",
  hash: "abc123",
  contentChecksum: "abc123-raw",
  contentType: "application/javascript",
  fileExt: "js",
  isLaunch: true,
};

const regularAsset = {
  key: "icon",
  hash: "def456",
  contentChecksum: "def456-raw",
  contentType: "image/png",
  fileExt: "png",
  isLaunch: false,
};

describe(buildManifest, () => {
  test("separates launch asset from regular assets with correct URLs", () => {
    const manifest = buildManifest({
      update: baseUpdate,
      assets: [launchAsset, regularAsset],
      assetBaseUrl: "https://cdn.example.com",
    }) as Record<string, unknown>;

    expect(manifest["id"]).toBe("update-1");
    expect(manifest["createdAt"]).toBe("2025-01-01T00:00:00.000Z");
    expect(manifest["runtimeVersion"]).toBe("1.0.0");

    const launch = manifest["launchAsset"] as Record<string, unknown>;
    expect(launch["hash"]).toBe("abc123-raw");
    expect(launch["key"]).toBe("bundle");
    expect(launch["url"]).toBe("https://cdn.example.com/assets/abc123");
    expect(launch).not.toHaveProperty("fileExtension");

    const assets = manifest["assets"] as Record<string, unknown>[];
    expect(assets).toHaveLength(1);
    expect(assets[0]!["hash"]).toBe("def456-raw");
    expect(assets[0]!["fileExtension"]).toBe(".png");
    expect(assets[0]!["url"]).toBe("https://cdn.example.com/assets/def456");
  });

  test("points launchAsset.url at the Worker bundle route when server origin is provided", () => {
    const manifest = buildManifest({
      update: baseUpdate,
      assets: [launchAsset, regularAsset],
      assetBaseUrl: "https://cdn.example.com",
      serverBaseUrl: "https://api.example.com",
      projectId: "proj1",
    }) as Record<string, unknown>;

    const launch = manifest["launchAsset"] as Record<string, unknown>;
    expect(launch["url"]).toBe("https://api.example.com/manifest/proj1/bundle/update-1/abc123");

    // Non-launch assets are not patched and keep their CDN URL.
    const assets = manifest["assets"] as Record<string, unknown>[];
    expect(assets[0]!["url"]).toBe("https://cdn.example.com/assets/def456");
  });

  test("falls back to the CDN launch URL when server origin is absent", () => {
    const manifest = buildManifest({
      update: baseUpdate,
      assets: [launchAsset],
      assetBaseUrl: "https://cdn.example.com",
    }) as Record<string, unknown>;

    const launch = manifest["launchAsset"] as Record<string, unknown>;
    expect(launch["url"]).toBe("https://cdn.example.com/assets/abc123");
  });

  test("emits extra from update without injecting scopeKey", () => {
    const manifest = buildManifest({
      update: baseUpdate,
      assets: [launchAsset],
      assetBaseUrl: "https://cdn.example.com",
    }) as Record<string, unknown>;

    const extra = manifest["extra"] as Record<string, unknown>;
    expect(extra).not.toHaveProperty("scopeKey");
    expect(extra["expoClient"]).toStrictEqual({ name: "test-app" });
  });

  test("emits empty extra when update.extra is undefined", () => {
    const manifest = buildManifest({
      update: { ...baseUpdate, extra: undefined },
      assets: [launchAsset],
      assetBaseUrl: "https://cdn.example.com",
    }) as Record<string, unknown>;

    expect(manifest["extra"]).toStrictEqual({});
  });

  // CONTRACT TEST: the byte string of a rendered manifest is what the CLI signs
  // and the server serves verbatim. The field order id, createdAt,
  // runtimeVersion, launchAsset, assets, metadata, extra is load-bearing — any
  // drift breaks signature byte-identity. This frozen literal guards against it.
  test("renders a byte-identical JSON string for a fixed input (signature contract)", () => {
    const rendered = JSON.stringify(
      buildManifest({
        update: {
          id: "update-1",
          createdAt: "2025-01-01T00:00:00.000Z",
          runtimeVersion: "1.0.0",
          metadata: { branchName: "main" },
          extra: { expoClient: { name: "test-app" } },
        },
        assets: [launchAsset, regularAsset],
        assetBaseUrl: "https://cdn.example.com",
        serverBaseUrl: "https://api.example.com",
        projectId: "proj1",
      }),
    );

    expect(rendered).toBe(
      '{"id":"update-1","createdAt":"2025-01-01T00:00:00.000Z","runtimeVersion":"1.0.0","launchAsset":{"hash":"abc123-raw","key":"bundle","contentType":"application/javascript","url":"https://api.example.com/manifest/proj1/bundle/update-1/abc123"},"assets":[{"hash":"def456-raw","key":"icon","contentType":"image/png","fileExtension":".png","url":"https://cdn.example.com/assets/def456"}],"metadata":{"branchName":"main"},"extra":{"expoClient":{"name":"test-app"}}}',
    );
  });
});

describe(buildExtensions, () => {
  test("returns only assetRequestHeaders when called with no args", () => {
    const extensions = buildExtensions() as Record<string, unknown>;
    expect(extensions["assetRequestHeaders"]).toStrictEqual({});
    expect(extensions).not.toHaveProperty("patchedAssets");
  });
});
