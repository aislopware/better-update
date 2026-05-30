import { patchR2Key } from "@better-update/expo-protocol";

import { parsePatchKey } from "./patch-key";

describe(parsePatchKey, () => {
  it("round-trips with patchR2Key into the exact lowercased tuple", () => {
    const key = patchR2Key({
      projectId: "proj1",
      runtimeVersion: "1.0.0",
      platform: "ios",
      fromUpdateId: "FROM-Id",
      toUpdateId: "TO-Id",
    });

    expect(parsePatchKey(key)).toStrictEqual({
      projectId: "proj1",
      runtimeVersion: "1.0.0",
      platform: "ios",
      // patchR2Key lowercases both update ids on disk.
      fromUpdateId: "from-id",
      toUpdateId: "to-id",
    });
  });

  it("parses an android key", () => {
    expect(parsePatchKey("patches/p/2.1.0/android/a__b.bsdiff")).toStrictEqual({
      projectId: "p",
      runtimeVersion: "2.1.0",
      platform: "android",
      fromUpdateId: "a",
      toUpdateId: "b",
    });
  });

  it("returns null when the patches/ prefix is missing", () => {
    expect(parsePatchKey("assets/abc")).toBeNull();
  });

  it("returns null when the .bsdiff suffix is missing", () => {
    expect(parsePatchKey("patches/p/1.0.0/ios/a__b")).toBeNull();
  });

  it("returns null on too few segments", () => {
    expect(parsePatchKey("patches/p/1.0.0/a__b.bsdiff")).toBeNull();
  });

  it("returns null on too many segments", () => {
    expect(parsePatchKey("patches/p/1.0.0/ios/extra/a__b.bsdiff")).toBeNull();
  });

  it("returns null when the from/to separator is missing", () => {
    expect(parsePatchKey("patches/p/1.0.0/ios/justone.bsdiff")).toBeNull();
  });

  it("returns null on a non-ios/android platform", () => {
    expect(parsePatchKey("patches/p/1.0.0/web/a__b.bsdiff")).toBeNull();
  });

  it("returns null on an empty segment", () => {
    expect(parsePatchKey("patches//1.0.0/ios/a__b.bsdiff")).toBeNull();
  });

  it("returns null on an empty from id", () => {
    expect(parsePatchKey("patches/p/1.0.0/ios/__b.bsdiff")).toBeNull();
  });

  it("returns null on an empty to id", () => {
    expect(parsePatchKey("patches/p/1.0.0/ios/a__.bsdiff")).toBeNull();
  });

  it("returns null on path traversal in a segment", () => {
    expect(parsePatchKey("patches/p/../ios/a__b.bsdiff")).toBeNull();
  });

  it("returns null when a second separator makes the from/to split ambiguous", () => {
    expect(parsePatchKey("patches/p/1.0.0/ios/a__b__c.bsdiff")).toBeNull();
  });
});
