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
  it("separates launch asset from regular assets with correct URLs", () => {
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

  it("emits extra from update without injecting scopeKey", () => {
    const manifest = buildManifest({
      update: baseUpdate,
      assets: [launchAsset],
      assetBaseUrl: "https://cdn.example.com",
    }) as Record<string, unknown>;

    const extra = manifest["extra"] as Record<string, unknown>;
    expect(extra).not.toHaveProperty("scopeKey");
    expect(extra["expoClient"]).toStrictEqual({ name: "test-app" });
  });

  it("emits empty extra when update.extra is undefined", () => {
    const manifest = buildManifest({
      update: { ...baseUpdate, extra: undefined },
      assets: [launchAsset],
      assetBaseUrl: "https://cdn.example.com",
    }) as Record<string, unknown>;

    expect(manifest["extra"]).toStrictEqual({});
  });
});

describe(buildDirective, () => {
  it("returns rollBackToEmbedded structure with commitTime", () => {
    const directive = buildDirective({ update: baseUpdate }) as Record<string, unknown>;

    expect(directive["type"]).toBe("rollBackToEmbedded");
    const params = directive["parameters"] as Record<string, unknown>;
    expect(params["commitTime"]).toBe("2025-01-01T00:00:00.000Z");
  });
});

describe(buildExtensions, () => {
  it("returns only assetRequestHeaders when called with no args", () => {
    const extensions = buildExtensions() as Record<string, unknown>;
    expect(extensions["assetRequestHeaders"]).toStrictEqual({});
    expect(extensions).not.toHaveProperty("patchedAssets");
  });
});
