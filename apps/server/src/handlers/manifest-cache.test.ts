import { buildCacheKey } from "./manifest-cache";

const baseParams = {
  cacheVersion: 3,
  scopeKey: "https://updates.better-update.dev",
  projectId: "proj_abc",
  channelName: "production",
  platform: "ios",
  runtimeVersion: "1.0.0",
  resolvedBranchId: "branch_main",
  multipart: true,
  expectSignature: false,
} as const;

describe(buildCacheKey, () => {
  it("produces a stable key for identical inputs", () => {
    expect(buildCacheKey(baseParams)).toBe(buildCacheKey({ ...baseParams }));
  });

  it("places scopeKey right after the cache version and before projectId", () => {
    expect(buildCacheKey(baseParams)).toBe(
      "https://cache.internal/_cache/v3/scope/https%3A%2F%2Fupdates.better-update.dev/manifest/proj_abc/production/ios/1.0.0/branch_main/mp/nosig",
    );
  });

  it("encodeURIComponent-escapes the scopeKey so ':' and '/' do not create extra path segments", () => {
    const key = buildCacheKey(baseParams);
    // The origin must appear as a single escaped segment, never raw.
    expect(key).toContain("/scope/https%3A%2F%2Fupdates.better-update.dev/manifest/");
    expect(key).not.toContain("/scope/https://updates.better-update.dev/");
  });

  it("yields DIFFERENT keys for different scopeKeys with otherwise identical inputs", () => {
    const keyA = buildCacheKey({ ...baseParams, scopeKey: "https://a.example" });
    const keyB = buildCacheKey({ ...baseParams, scopeKey: "https://b.example" });
    expect(keyA).not.toBe(keyB);
  });

  it("keeps a non-default-port scopeKey distinct from the same host without a port", () => {
    const withPort = buildCacheKey({ ...baseParams, scopeKey: "https://acme.com:8080" });
    const noPort = buildCacheKey({ ...baseParams, scopeKey: "https://acme.com" });
    expect(withPort).not.toBe(noPort);
  });

  it("does not collide with an old projectId-only key shape (cold miss expected)", () => {
    const newKey = buildCacheKey(baseParams);
    const oldShape = `https://cache.internal/_cache/v${baseParams.cacheVersion}/manifest/${baseParams.projectId}/${baseParams.channelName}/${baseParams.platform}/${baseParams.runtimeVersion}/${baseParams.resolvedBranchId}/mp/nosig`;
    expect(newKey).not.toBe(oldShape);
  });
});
