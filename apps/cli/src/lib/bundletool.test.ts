import { universalApkArgs } from "./bundletool";

describe(universalApkArgs, () => {
  it("requests a universal .apks set and points at the bundle + output", () => {
    const args = universalApkArgs({
      aabPath: "/tmp/app.aab",
      apksPath: "/tmp/app.apks",
      signing: undefined,
    });
    expect(args).toStrictEqual([
      "build-apks",
      "--bundle=/tmp/app.aab",
      "--output=/tmp/app.apks",
      "--mode=universal",
      "--overwrite",
    ]);
  });

  it("passes keystore passwords as file references, never inline", () => {
    const args = universalApkArgs({
      aabPath: "/tmp/app.aab",
      apksPath: "/tmp/app.apks",
      signing: {
        keystorePath: "/tmp/upload.jks",
        keyAlias: "upload",
        storePassFile: "/tmp/ks-pass",
        keyPassFile: "/tmp/key-pass",
      },
    });
    expect(args).toContain("--ks=/tmp/upload.jks");
    expect(args).toContain("--ks-key-alias=upload");
    expect(args).toContain("--ks-pass=file:/tmp/ks-pass");
    expect(args).toContain("--key-pass=file:/tmp/key-pass");
    expect(args.some((arg) => arg.startsWith("--ks-pass=pass:"))).toBe(false);
  });
});
