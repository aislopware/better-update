import { resolveCustomIosDir } from "./ios";

// A custom iOS build bypasses `prepareIosNative`, so this is what decides
// whether the OTA channel lands in the Expo.plist that ships. Getting it wrong
// is silent — the binary just falls back to the server's default channel.
describe(resolveCustomIosDir, () => {
  it("derives the ios dir from an explicit workspace, wherever it lives", () => {
    expect(
      resolveCustomIosDir({
        projectRoot: "/w/app",
        container: "iosApp/MyApp.xcworkspace",
        cwd: "/w/app",
      }),
    ).toBe("/w/app/iosApp");
  });

  it("falls back to <cwd>/ios when the profile names no container", () => {
    expect(
      resolveCustomIosDir({
        projectRoot: "/w/app",
        container: undefined,
        cwd: "/w/app/packages/m",
      }),
    ).toBe("/w/app/packages/m/ios");
  });

  // A custom block whose `cwd` is already `ios/` must not get `ios/ios`.
  it("accepts a cwd that is already the ios dir", () => {
    expect(
      resolveCustomIosDir({ projectRoot: "/w/app", container: undefined, cwd: "/w/app/ios" }),
    ).toBe("/w/app/ios");
  });
});
