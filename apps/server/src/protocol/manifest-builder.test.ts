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

// buildManifest + buildExtensions are now defined and exhaustively tested in
// @better-update/expo-protocol (render byte-identity, launch/regular split, CDN
// fallback, extra passthrough). Here we keep only a thin smoke test that the
// re-export from this server module is wired, so handlers/manifest.ts keeps a
// working import — the full coverage lives with the shared package.
describe("manifest-builder re-exports", () => {
  it("re-exports buildManifest from the shared package", () => {
    const manifest = buildManifest({
      update: baseUpdate,
      assets: [launchAsset],
      assetBaseUrl: "https://cdn.example.com",
    }) as Record<string, unknown>;
    expect(manifest["id"]).toBe("update-1");
    const launch = manifest["launchAsset"] as Record<string, unknown>;
    expect(launch["url"]).toBe("https://cdn.example.com/assets/abc123");
  });

  it("re-exports buildExtensions from the shared package", () => {
    const extensions = buildExtensions() as Record<string, unknown>;
    expect(extensions["assetRequestHeaders"]).toStrictEqual({});
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
