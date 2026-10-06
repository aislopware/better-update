import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { setupCliE2E } from "../helpers/cli-e2e";

/**
 * A real Electron app updating itself on macOS from the real server: the
 * fixture is built twice by `build --platform macos` (electron-builder signs
 * it with the vault's Developer ID identity from the CLI's keychain, the CLI audits
 * and zips it), released with `macos release create`, unzipped and run.
 * electron-updater reads `latest-mac.yml`, finds nothing newer while only
 * 1.0.0 is released, then downloads 1.1.0 and hands it to Squirrel.Mac,
 * which checks the update's code signature against the running app's and
 * swaps the bundle in place on quit — after which the app reports 1.1.0.
 *
 * Gated on a real Developer ID .p12 like the other macOS journeys:
 *
 *   E2E_MACOS_DEVELOPER_ID_P12=… E2E_MACOS_DEVELOPER_ID_P12_PASSWORD=… \
 *     bun run test:slow -- tests/slow/electron-macos-update.test.ts
 *
 * The apps' update logs are kept in `$TMPDIR/better-update-e2e/electron-macos-update/`.
 */
const P12_PATH = process.env["E2E_MACOS_DEVELOPER_ID_P12"];
const P12_PASSWORD = process.env["E2E_MACOS_DEVELOPER_ID_P12_PASSWORD"];
const canRun =
  process.platform === "darwin" && P12_PATH !== undefined && P12_PASSWORD !== undefined;

const FIXTURE_DIR = path.resolve(import.meta.dirname, "../../../../fixtures/electron-app");
const EVIDENCE_DIR = path.join(os.tmpdir(), "better-update-e2e", "electron-macos-update");
const PAYLOAD_BYTES = 4 * 1024 * 1024;
const APP_NAME = "Example Electron.app";
const home = os.homedir();
// The CLI runs with an isolated HOME; Electron and bun keep their real caches.
const CACHE_ENV = {
  ELECTRON_CACHE: path.join(home, "Library", "Caches", "electron"),
  ELECTRON_BUILDER_CACHE: path.join(home, "Library", "Caches", "electron-builder"),
  BUN_INSTALL_CACHE_DIR: path.join(home, ".bun", "install", "cache"),
};

const profile = (version: string) => ({
  macos: { artifact: "zip", notarize: false },
  custom: {
    macos: {
      command: `bunx electron-builder --mac zip --${process.arch} -c.extraMetadata.version=${version} --publish never`,
      // The zip electron-builder makes: its app carries the app-update.yml electron-updater reads.
      artifactPath: "dist/*.zip",
    },
  },
});

const cli = setupCliE2E("slow-cli-electron-macos", {
  noExpoConfig: true,
  appJsonTemplate: { expo: { name: "Electron macOS E2E", slug: "electron-macos-e2e" } },
  userEmail: "slow-cli-electron-macos@example.com",
  orgSlug: "slow-cli-electron-macos-org",
});

const expectSuccess = (result: {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}) => {
  expect(
    result.exitCode === 0
      ? ""
      : `exit ${String(result.exitCode)}: ${result.stderr}\n${result.stdout.slice(-6000)}`,
  ).toBe("");
};

const buildIdFrom = (stdout: string): string =>
  /Build ID\s+(?<id>\S+)/u.exec(stdout)?.groups?.["id"] ?? "";

/** Deterministic incompressible bytes both versions ship unchanged. */
const payload = () =>
  Buffer.concat(
    Array.from({ length: PAYLOAD_BYTES / 32 }, (_, index) =>
      createHash("sha256")
        .update(`electron payload ${String(index)}`)
        .digest(),
    ),
  );

const shortVersion = (app: string) =>
  execFileSync(
    "/usr/libexec/PlistBuddy",
    ["-c", "Print CFBundleShortVersionString", path.join(app, "Contents", "Info.plist")],
    { encoding: "utf8" },
  ).trim();

describe.skipIf(!canRun)("Electron on macOS updates itself through Squirrel.Mac", () => {
  let workRoot = "";
  let app = "";

  const buildAndRelease = (profileName: string, output: string) => {
    const built = cli.runCliWithEnv(
      CACHE_ENV,
      "build",
      "--platform",
      "macos",
      "--profile",
      profileName,
      "--allow-dirty",
      "--output",
      output,
    );
    expectSuccess(built);
    expectSuccess(
      cli.runCli("macos", "release", "create", buildIdFrom(built.stdout), "--file", output),
    );
  };

  /** Run the installed app until it quits; everything it saw is in `log`. */
  const runApp = (log: string, checkUpdates: boolean) => {
    const run = spawnSync(path.join(app, "Contents", "MacOS", "Example Electron"), [], {
      env: {
        ...process.env,
        UPDATE_LOG: path.join(workRoot, "logs", log),
        CHECK_UPDATES: checkUpdates ? "1" : "0",
        FEED_URL: `${cli.getBaseUrl()}/feeds/${cli.getProjectId()}/macos`,
      },
      encoding: "utf8",
      timeout: 3 * 60 * 1000,
    });
    expect(run.error).toBeUndefined();
    return readFileSync(path.join(workRoot, "logs", log), "utf8");
  };

  beforeAll(async () => {
    workRoot = mkdtempSync(path.join(os.tmpdir(), "electron-macos-e2e-"));
    mkdirSync(path.join(workRoot, "logs"));
    const projectDir = cli.getProjectDir();
    cpSync(FIXTURE_DIR, projectDir, { recursive: true });
    writeFileSync(path.join(projectDir, "payload.bin"), payload());
    writeFileSync(
      path.join(projectDir, "eas.json"),
      `${JSON.stringify(
        {
          projectId: cli.getProjectId(),
          build: { "electron-v1": profile("1.0.0"), "electron-v2": profile("1.1.0") },
        },
        null,
        2,
      )}\n`,
    );
    await cli.bootstrapOrgVault();
    expectSuccess(
      cli.runCli(
        "credentials",
        "upload",
        "--platform",
        "macos",
        "--type",
        "macos-certificate",
        "--name",
        "E2E Developer ID",
        "--file",
        P12_PATH!,
        "--password",
        P12_PASSWORD!,
      ),
    );
  });

  afterAll(() => {
    // electron-updater keeps the downloaded update under the real user's caches.
    rmSync(path.join(home, "Library", "Caches", "example-electron-updater"), {
      recursive: true,
      force: true,
    });
    if (workRoot !== "" && existsSync(workRoot)) {
      rmSync(EVIDENCE_DIR, { recursive: true, force: true });
      mkdirSync(path.dirname(EVIDENCE_DIR), { recursive: true });
      cpSync(path.join(workRoot, "logs"), EVIDENCE_DIR, { recursive: true });
      rmSync(workRoot, { recursive: true, force: true });
    }
  });

  test("finds no update while only the installed version is released", () => {
    const v1Zip = path.join(workRoot, "Example-Electron-1.0.0.zip");
    buildAndRelease("electron-v1", v1Zip);
    const install = path.join(workRoot, "Applications");
    mkdirSync(install);
    execFileSync("ditto", ["-x", "-k", v1Zip, install]);
    app = path.join(install, APP_NAME);
    expect(shortVersion(app)).toBe("1.0.0");
    // electron-builder signed it with the vault's identity, hardened runtime on.
    const signature = spawnSync("codesign", ["-dv", "--verbose=2", app], {
      encoding: "utf8",
    }).stderr;
    expect(signature).toContain("Authority=Developer ID Application: ");
    expect(signature).toMatch(/flags=0x10000\(runtime\)/u);

    const log = runApp("no-update.log", true);
    expect(log).toContain("version 1.0.0");
    expect(log).toContain("update-not-available");
  });

  test("Squirrel.Mac installs 1.1.0 over the running app", async () => {
    buildAndRelease("electron-v2", path.join(workRoot, "Example-Electron-1.1.0.zip"));
    const log = runApp("update.log", true);
    expect(log).toContain("version 1.0.0");
    expect(log).toContain("update-downloaded 1.1.0");

    // ShipIt swaps the bundle once the app has quit.
    await vi.waitFor(
      () => {
        expect(shortVersion(app)).toBe("1.1.0");
      },
      { timeout: 120_000, interval: 1000 },
    );
    execFileSync("codesign", ["--verify", "--deep", "--strict", app]);
    expect(runApp("after.log", false).trim()).toBe("version 1.1.0");
  });
});
