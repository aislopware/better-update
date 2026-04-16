import { buildDirective, buildExtensions, buildManifest } from "./manifest-builder";

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
      scopeKey: "scope-1",
      assetBaseUrl: "https://cdn.example.com",
    }) as Record<string, unknown>;

    expect(manifest["id"]).toBe("update-1");
    expect(manifest["createdAt"]).toBe("2025-01-01T00:00:00.000Z");
    expect(manifest["runtimeVersion"]).toBe("1.0.0");

    const launch = manifest["launchAsset"] as Record<string, unknown>;
    // ContentChecksum (raw SHA-256) used for client integrity verification
    expect(launch["hash"]).toBe("abc123-raw");
    expect(launch["key"]).toBe("bundle");
    // Namespaced hash used for URL routing
    expect(launch["url"]).toBe("https://cdn.example.com/assets/abc123");
    expect(launch).not.toHaveProperty("fileExtension");

    const assets = manifest["assets"] as Record<string, unknown>[];
    expect(assets).toHaveLength(1);
    expect(assets[0]!["hash"]).toBe("def456-raw");
    expect(assets[0]!["fileExtension"]).toBe(".png");
    expect(assets[0]!["url"]).toBe("https://cdn.example.com/assets/def456");
  });

  test("puts scopeKey in extra alongside update.extra", () => {
    const manifest = buildManifest({
      update: baseUpdate,
      assets: [launchAsset],
      scopeKey: "scope-1",
      assetBaseUrl: "https://cdn.example.com",
    }) as Record<string, unknown>;

    const extra = manifest["extra"] as Record<string, unknown>;
    expect(extra["scopeKey"]).toBe("scope-1");
    expect(extra["expoClient"]).toEqual({ name: "test-app" });
  });

  test("handles undefined extra on update", () => {
    const manifest = buildManifest({
      update: { ...baseUpdate, extra: undefined },
      assets: [launchAsset],
      scopeKey: "scope-1",
      assetBaseUrl: "https://cdn.example.com",
    }) as Record<string, unknown>;

    const extra = manifest["extra"] as Record<string, unknown>;
    expect(extra["scopeKey"]).toBe("scope-1");
  });
});

describe(buildDirective, () => {
  test("returns rollBackToEmbedded structure with commitTime", () => {
    const directive = buildDirective({ update: baseUpdate }) as Record<string, unknown>;

    expect(directive["type"]).toBe("rollBackToEmbedded");
    const params = directive["parameters"] as Record<string, unknown>;
    expect(params["commitTime"]).toBe("2025-01-01T00:00:00.000Z");
  });
});

describe(buildExtensions, () => {
  test("returns only assetRequestHeaders when called with no args", () => {
    const extensions = buildExtensions() as Record<string, unknown>;
    expect(extensions["assetRequestHeaders"]).toEqual({});
    expect(extensions).not.toHaveProperty("patchedAssets");
  });
});
