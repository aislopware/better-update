import { Schema } from "effect";

import { AssetUploadBody, AssetUploadResult } from "./asset";

describe(AssetUploadBody, () => {
  test("decodes valid body", () => {
    const result = Schema.decodeUnknownSync(AssetUploadBody)({
      assets: [
        { hash: "abc123", contentType: "application/javascript", fileExt: ".js" },
        { hash: "def456", contentType: "image/png", fileExt: ".png" },
      ],
    });
    expect(result.assets).toHaveLength(2);
    expect(result.assets[0]?.hash).toBe("abc123");
  });

  test("accepts empty assets array", () => {
    const result = Schema.decodeUnknownSync(AssetUploadBody)({ assets: [] });
    expect(result.assets).toHaveLength(0);
  });

  test("rejects missing hash", () => {
    expect(() =>
      Schema.decodeUnknownSync(AssetUploadBody)({
        assets: [{ contentType: "text/plain", fileExt: ".txt" }],
      }),
    ).toThrow();
  });
});

describe(AssetUploadResult, () => {
  test("decodes valid result", () => {
    const result = Schema.decodeUnknownSync(AssetUploadResult)({
      uploaded: ["abc123"],
      deduplicated: ["def456"],
    });
    expect(result.uploaded).toEqual(["abc123"]);
    expect(result.deduplicated).toEqual(["def456"]);
  });
});
