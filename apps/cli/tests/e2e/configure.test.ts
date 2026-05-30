import path from "node:path";

import { setupCliE2E } from "../helpers/cli-e2e";

const FIXTURE_DIR = path.resolve(import.meta.dirname, "../../../../fixtures/e2e-app");

// Starts WITH a top-level runtimeVersion and NO `updates` block: that's the
// shape a fresh Expo app has, and it lets us exercise the "already configured"
// guard (runtimeVersion is set) before forcing the write.
const configureAppJsonTemplate = {
  expo: {
    name: "Configure App",
    slug: "configure-app",
    owner: "configure-app-owner",
    version: "1.0.0",
    runtimeVersion: "1.0.0",
    ios: {
      bundleIdentifier: "com.example.configure",
      buildNumber: "1",
    },
    android: {
      package: "com.example.configure",
      versionCode: 1,
    },
    extra: {
      betterUpdate: {
        profiles: {
          production: {
            environment: "production",
            ios: { distribution: "ad-hoc" },
            android: { distribution: "direct", format: "apk" },
          },
        },
      },
    },
  },
};

const cli = setupCliE2E("e2e-cli-configure", {
  projectDir: FIXTURE_DIR,
  appJsonTemplate: configureAppJsonTemplate,
  userEmail: "cli-e2e-configure@example.com",
  orgSlug: "cli-e2e-configure-org",
});

// ── Helpers ──────────────────────────────────────────────────────

interface ExpoUpdates {
  readonly url?: string;
  readonly enabled?: boolean;
  readonly checkAutomatically?: string;
  readonly fallbackToCacheTimeout?: number;
  readonly useEmbeddedUpdate?: boolean;
  readonly enableBsdiffPatchSupport?: boolean;
  readonly disableAntiBrickingMeasures?: boolean;
}

const readExpo = () => cli.readAppJson()["expo"] as Record<string, unknown>;
const readUpdates = (): ExpoUpdates | undefined => readExpo()["updates"] as ExpoUpdates | undefined;

// ── Tests ────────────────────────────────────────────────────────

describe("update configure: writes the expo-updates surface incl. enableBsdiffPatchSupport", () => {
  it("links the fixture app to the seeded project", () => {
    const result = cli.runCli("init");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Project linked successfully");
    // Precondition: no `updates` block yet — only the top-level runtimeVersion.
    expect(readUpdates()).toBeUndefined();
  });

  it("refuses to write when runtimeVersion is already set (no --force)", () => {
    const result = cli.runCli("update", "configure");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("already has runtimeVersion");
    expect(result.stdout).toContain("Pass --force");
    // Guard returned before writing: still no updates block.
    expect(readUpdates()).toBeUndefined();
  });

  it("--force wires the full updates surface with bsdiff ON by default", () => {
    const result = cli.runCli("update", "configure", "--force");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Wired expo-updates plugin");

    const updates = readUpdates();
    expect(updates).toBeDefined();
    // The whole documented default surface lands…
    expect(updates!.url).toBe(`${cli.getBaseUrl()}/manifest/${cli.getProjectId()}`);
    expect(updates!.enabled).toBe(true);
    expect(updates!.checkAutomatically).toBe("ON_LOAD");
    expect(updates!.fallbackToCacheTimeout).toBe(0);
    expect(updates!.useEmbeddedUpdate).toBe(true);
    expect(updates!.disableAntiBrickingMeasures).toBe(false);
    // …including the device-side bsdiff toggle defaulting to true — without this
    // the server's whole A-IM: bsdiff content negotiation is inert.
    expect(updates!.enableBsdiffPatchSupport).toBe(true);

    // The string runtimeVersion is replaced by a policy object.
    expect(readExpo()["runtimeVersion"]).toStrictEqual({ policy: "appVersion" });
  });

  it("--no-enable-bsdiff flips the toggle off while preserving other fields", () => {
    const result = cli.runCli("update", "configure", "--force", "--no-enable-bsdiff");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Wired expo-updates plugin");

    const updates = readUpdates();
    expect(updates).toBeDefined();
    // Only the bsdiff toggle changed; the rest of the surface is preserved
    // (explicit flag ?? existing value ?? default — not clobbered to defaults).
    expect(updates!.enableBsdiffPatchSupport).toBe(false);
    expect(updates!.checkAutomatically).toBe("ON_LOAD");
    expect(updates!.url).toBe(`${cli.getBaseUrl()}/manifest/${cli.getProjectId()}`);
    expect(updates!.useEmbeddedUpdate).toBe(true);
  });
});
