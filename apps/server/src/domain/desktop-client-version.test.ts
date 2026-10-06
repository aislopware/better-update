import { desktopClientVersion } from "./desktop-client-version";

const versionOf = (userAgent: string | null, query = "") =>
  desktopClientVersion({ userAgent, query: new URLSearchParams(query) });

describe(desktopClientVersion, () => {
  it("reads Sparkle's and WinSparkle's user agents", () => {
    expect(versionOf("Example App/2.4.1 Sparkle/2.10.0")).toBe("2.4.1");
    expect(versionOf("ExampleApp/1.0.0-beta.2 Sparkle/2.9.1")).toBe("1.0.0-beta.2");
    expect(versionOf("ExampleApp/3.1 WinSparkle/0.9.4")).toBe("3.1");
  });

  it("reads the app version from Electron's default user agent", () => {
    expect(
      versionOf(
        "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) example-electron-linux/1.1.0 Chrome/144.0.7559.60 Electron/44.5.1 Safari/537.36",
      ),
    ).toBe("1.1.0");
  });

  it("prefers a version the endpoint names, as a Tauri endpoint templates it", () => {
    expect(versionOf("tauri-updater", "current_version=0.4.2")).toBe("0.4.2");
    expect(versionOf("Example/1.0.0 Sparkle/2.10.0", "appVersion=v1.2.0")).toBe("1.2.0");
  });

  it("ignores what is not a version", () => {
    expect(versionOf(null)).toBeUndefined();
    expect(versionOf("curl/8.7.1")).toBeUndefined();
    expect(versionOf("Mozilla/5.0 (Macintosh) Safari/605.1.15")).toBeUndefined();
    expect(versionOf("Example/latest Sparkle/2.10.0")).toBeUndefined();
    expect(versionOf("tauri-updater", "current_version=';DROP")).toBeUndefined();
  });
});
