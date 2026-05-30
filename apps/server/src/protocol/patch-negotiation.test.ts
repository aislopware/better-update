import {
  isValidPatchKey,
  parsePatchRequest,
  patchR2Key,
  patchResponseHeaders,
  selectPatchCandidates,
  validateAssetRuntime,
} from "./patch-negotiation";

const headersFrom = (init: Record<string, string>): Headers => new Headers(init);

describe(parsePatchRequest, () => {
  it("reads all negotiation headers and lowercases update ids", () => {
    const result = parsePatchRequest(
      headersFrom({
        "a-im": "bsdiff",
        "expo-current-update-id": "CURRENT-ID",
        "expo-embedded-update-id": "EMBEDDED-ID",
        "expo-requested-update-id": "TARGET-ID",
        "expo-runtime-version": "1.0.0",
        "expo-platform": "ios",
      }),
    );

    expect(result.supportsBsdiff).toBe(true);
    expect(result.currentUpdateId).toBe("current-id");
    expect(result.embeddedUpdateId).toBe("embedded-id");
    expect(result.requestedUpdateId).toBe("target-id");
    expect(result.runtimeVersion).toBe("1.0.0");
    expect(result.platform).toBe("ios");
  });

  it("treats absent a-im as no bsdiff support", () => {
    const result = parsePatchRequest(headersFrom({ "expo-platform": "android" }));
    expect(result.supportsBsdiff).toBe(false);
    expect(result.platform).toBe("android");
    expect(result.currentUpdateId).toBeUndefined();
    expect(result.embeddedUpdateId).toBeUndefined();
    expect(result.requestedUpdateId).toBeUndefined();
    expect(result.runtimeVersion).toBeUndefined();
  });

  it("detects bsdiff inside a comma-separated a-im list (case-insensitive)", () => {
    expect(parsePatchRequest(headersFrom({ "a-im": "gzip, BsDiff" })).supportsBsdiff).toBe(true);
    expect(parsePatchRequest(headersFrom({ "a-im": "gzip, deflate" })).supportsBsdiff).toBe(false);
  });

  it("ignores an unknown platform value", () => {
    expect(parsePatchRequest(headersFrom({ "expo-platform": "web" })).platform).toBeUndefined();
  });

  it("does not lowercase the runtime version", () => {
    expect(
      parsePatchRequest(headersFrom({ "expo-runtime-version": "Exposure-2024" })).runtimeVersion,
    ).toBe("Exposure-2024");
  });
});

describe(patchR2Key, () => {
  it("builds patches/{project}/{rv}/{platform}/{from}__{to}.bsdiff", () => {
    expect(
      patchR2Key({
        projectId: "proj1",
        runtimeVersion: "1.0.0",
        platform: "ios",
        fromUpdateId: "from-id",
        toUpdateId: "to-id",
      }),
    ).toBe("patches/proj1/1.0.0/ios/from-id__to-id.bsdiff");
  });

  it("lowercases both update ids", () => {
    expect(
      patchR2Key({
        projectId: "proj1",
        runtimeVersion: "1.0.0",
        platform: "android",
        fromUpdateId: "FROM",
        toUpdateId: "TO",
      }),
    ).toBe("patches/proj1/1.0.0/android/from__to.bsdiff");
  });
});

describe(isValidPatchKey, () => {
  const params = {
    projectId: "proj1",
    runtimeVersion: "1.0.0",
    platform: "ios",
    fromUpdateId: "from-id",
    toUpdateId: "to-id",
  };

  it("accepts the canonical key built for the tuple", () => {
    expect(isValidPatchKey(patchR2Key(params), params)).toBe(true);
  });

  it("rejects a key that does not match the canonical key", () => {
    expect(isValidPatchKey("patches/proj1/1.0.0/ios/other__to-id.bsdiff", params)).toBe(false);
  });

  it("rejects a tuple segment containing a path separator", () => {
    const evil = { ...params, projectId: "proj1/../../etc" };
    expect(isValidPatchKey(patchR2Key(evil), evil)).toBe(false);
  });

  it("rejects a tuple segment containing parent-directory traversal", () => {
    const evil = { ...params, runtimeVersion: ".." };
    expect(isValidPatchKey(patchR2Key(evil), evil)).toBe(false);
  });

  it("rejects a tuple segment containing a backslash", () => {
    const evil = { ...params, platform: "i\\os" };
    expect(isValidPatchKey(patchR2Key(evil), evil)).toBe(false);
  });

  it("rejects a tuple segment containing a NUL byte", () => {
    const evil = { ...params, toUpdateId: "to\0id" };
    expect(isValidPatchKey(patchR2Key(evil), evil)).toBe(false);
  });

  it("rejects an empty tuple segment", () => {
    const evil = { ...params, fromUpdateId: "" };
    expect(isValidPatchKey(patchR2Key(evil), evil)).toBe(false);
  });

  it("matches case-insensitively via the canonical lowercased key", () => {
    const upper = { ...params, fromUpdateId: "FROM", toUpdateId: "TO" };
    // patchR2Key lowercases the ids, so the canonical key uses lowercase.
    expect(isValidPatchKey("patches/proj1/1.0.0/ios/from__to.bsdiff", upper)).toBe(true);
  });
});

describe(selectPatchCandidates, () => {
  const req = (overrides: Partial<ReturnType<typeof parsePatchRequest>>) => ({
    supportsBsdiff: true,
    currentUpdateId: undefined,
    embeddedUpdateId: undefined,
    requestedUpdateId: undefined,
    runtimeVersion: undefined,
    platform: undefined,
    ...overrides,
  });

  it("orders [current, embedded]", () => {
    expect(
      selectPatchCandidates(req({ currentUpdateId: "cur", embeddedUpdateId: "emb" }), "target"),
    ).toStrictEqual(["cur", "emb"]);
  });

  it("drops undefined candidates", () => {
    expect(selectPatchCandidates(req({ embeddedUpdateId: "emb" }), "target")).toStrictEqual([
      "emb",
    ]);
  });

  it("drops a candidate equal to the target (self-patch)", () => {
    expect(
      selectPatchCandidates(req({ currentUpdateId: "same", embeddedUpdateId: "emb" }), "SAME"),
    ).toStrictEqual(["emb"]);
  });

  it("lowercases candidates and dedups", () => {
    expect(
      selectPatchCandidates(req({ currentUpdateId: "CUR", embeddedUpdateId: "cur" }), "target"),
    ).toStrictEqual(["cur"]);
  });

  it("returns empty when no usable candidates", () => {
    expect(selectPatchCandidates(req({}), "target")).toStrictEqual([]);
  });
});

describe(patchResponseHeaders, () => {
  it("emits im:bsdiff + lowercased expo-base-update-id", () => {
    expect(patchResponseHeaders("BASE-ID")).toStrictEqual({
      im: "bsdiff",
      "expo-base-update-id": "base-id",
    });
  });
});

describe(validateAssetRuntime, () => {
  it("treats an absent header as valid (pre-56.0.6 clients)", () => {
    expect(
      validateAssetRuntime({ headerRuntimeVersion: undefined, updateRuntimeVersion: "1.0.0" }),
    ).toBe(true);
  });

  it("is valid when header matches the update runtime version", () => {
    expect(
      validateAssetRuntime({ headerRuntimeVersion: "1.0.0", updateRuntimeVersion: "1.0.0" }),
    ).toBe(true);
  });

  it("is invalid when header mismatches", () => {
    expect(
      validateAssetRuntime({ headerRuntimeVersion: "2.0.0", updateRuntimeVersion: "1.0.0" }),
    ).toBe(false);
  });
});
