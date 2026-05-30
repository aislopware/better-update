import { toApiPatchBaseCandidate, toApiPatchUploadResult } from "./to-api-patch";

import type { PatchBaseRow } from "../repositories/update-patch-base-sql";

describe(toApiPatchBaseCandidate, () => {
  const row: PatchBaseRow = {
    updateId: "u1",
    launchAssetHash: "hash-1",
    runtimeVersion: "1.0.0",
    platform: "ios",
    isEmbedded: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  it("maps a repository row onto the PatchBaseCandidate contract shape", () => {
    const result = toApiPatchBaseCandidate(row);
    expect(result.updateId).toBe("u1");
    expect(result.launchAssetHash).toBe("hash-1");
    expect(result.runtimeVersion).toBe("1.0.0");
    expect(result.platform).toBe("ios");
    expect(result.isEmbedded).toBe(true);
    expect(result.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("preserves a non-embedded baseline flag", () => {
    expect(toApiPatchBaseCandidate({ ...row, isEmbedded: false }).isEmbedded).toBe(false);
  });
});

describe(toApiPatchUploadResult, () => {
  it("passes through key, url, expiry and headers unchanged", () => {
    const result = toApiPatchUploadResult({
      key: "patches/p/1.0.0/ios/a__b.bsdiff",
      uploadUrl: "https://example.com/put",
      uploadExpiresAt: "2026-01-01T00:00:00.000Z",
      uploadHeaders: { "content-type": "application/octet-stream" },
    });
    expect(result.key).toBe("patches/p/1.0.0/ios/a__b.bsdiff");
    expect(result.uploadUrl).toBe("https://example.com/put");
    expect(result.uploadExpiresAt).toBe("2026-01-01T00:00:00.000Z");
    expect(result.uploadHeaders).toStrictEqual({ "content-type": "application/octet-stream" });
  });
});
