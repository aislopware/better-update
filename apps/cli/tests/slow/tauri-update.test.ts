import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { setupCliE2E } from "../helpers/cli-e2e";

/**
 * The Tauri updater against the real server: a Tauri v2 app built by
 * `build --platform macos` (custom command, signed with the vault Developer ID
 * identity, shipped as `.app.tar.gz`), released with a Tauri updater key, and
 * an installed older build that polls the feed, checks the minisign signature
 * and the signed version, replaces itself and reports the new version.
 *
 * Gated on a real Developer ID .p12 (like the other macOS journeys) and a Rust
 * toolchain; the cargo target dir is cached under ~/.cache so reruns compile
 * in seconds:
 *
 *   E2E_MACOS_DEVELOPER_ID_P12=… E2E_MACOS_DEVELOPER_ID_P12_PASSWORD=… \
 *     bun run test:slow -- tests/slow/tauri-update.test.ts
 */
const P12_PATH = process.env["E2E_MACOS_DEVELOPER_ID_P12"];
const P12_PASSWORD = process.env["E2E_MACOS_DEVELOPER_ID_P12_PASSWORD"];
const hasCargo = spawnSync("cargo", ["--version"]).status === 0;
const canRun =
  process.platform === "darwin" && P12_PATH !== undefined && P12_PASSWORD !== undefined && hasCargo;

const FIXTURE_DIR = path.resolve(import.meta.dirname, "../../../../fixtures/tauri-app");
const TAURI_CLI = "@tauri-apps/cli@2.12.1";
const KEY_PASSWORD = "test-pass";
const home = os.homedir();
// The CLI runs with an isolated HOME; the toolchains keep their real caches.
const TOOLCHAIN_ENV = {
  CARGO_HOME: process.env["CARGO_HOME"] ?? path.join(home, ".cargo"),
  RUSTUP_HOME: process.env["RUSTUP_HOME"] ?? path.join(home, ".rustup"),
  CARGO_TARGET_DIR: path.join(home, ".cache", "better-update-e2e", "tauri-target"),
  BUN_INSTALL_CACHE_DIR: path.join(home, ".bun", "install", "cache"),
  // The harness runs the CLI with CI=1; Tauri's CLI reads CI as a boolean flag.
  CI: "true",
};

const cli = setupCliE2E("slow-cli-tauri-update", {
  userEmail: "slow-cli-tauri-update@example.com",
  orgSlug: "slow-cli-tauri-update-org",
});

const expectSuccess = (result: {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}) => {
  expect(
    result.exitCode === 0
      ? ""
      : `exit ${result.exitCode}: ${result.stderr}\n${result.stdout.slice(-6000)}`,
  ).toBe("");
};

const run = (command: string, args: readonly string[]): string =>
  execFileSync(command, [...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const buildIdFrom = (stdout: string): string =>
  /Build ID\s+(?<id>\S+)/u.exec(stdout)?.groups?.["id"] ?? "";

const shortVersionOf = (app: string) =>
  run("plutil", [
    "-extract",
    "CFBundleShortVersionString",
    "raw",
    path.join(app, "Contents", "Info.plist"),
  ]).trim();

/** Start the installed app against `endpoint` and return what it wrote once it quit. */
const runUpdater = async (app: string, endpoint: string, resultFile: string): Promise<string> => {
  rmSync(resultFile, { force: true });
  const child = spawn(path.join(app, "Contents", "MacOS", "tauri-fixture"), [], {
    env: { ...process.env, FIXTURE_UPDATE_ENDPOINT: endpoint, FIXTURE_RESULT_FILE: resultFile },
    stdio: "ignore",
  });
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => {
      resolve();
    });
  });
  const timedOut = new Promise<void>((resolve) => {
    setTimeout(resolve, 120_000);
  });
  await Promise.race([exited, timedOut]);
  child.kill("SIGKILL");
  return existsSync(resultFile) ? readFileSync(resultFile, "utf8") : "no result";
};

describe.skipIf(!canRun)("CLI build journey — Tauri updater", () => {
  let workRoot = "";
  let v2Path = "";
  let installs = "";

  const setVersion = (version: string) => {
    const configPath = path.join(cli.getProjectDir(), "src-tauri", "tauri.conf.json");
    const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    writeFileSync(configPath, `${JSON.stringify({ ...config, version }, null, 2)}\n`);
  };

  const build = (output: string, upload: boolean) =>
    cli.runCli(
      "build",
      "--platform",
      "macos",
      "--profile",
      "tauri",
      "--allow-dirty",
      ...(upload ? [] : ["--no-upload"]),
      "--output",
      output,
    );

  const releaseEnv = (keyFile: string) => ({
    TAURI_SIGNING_PRIVATE_KEY: keyFile,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: KEY_PASSWORD,
  });

  beforeAll(async () => {
    // Tauri refuses to update from a path with a symlink in it (/var → /private/var).
    workRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), "tauri-update-e2e-")));
    installs = path.join(workRoot, "installs");
    mkdirSync(installs);
    mkdirSync(TOOLCHAIN_ENV.CARGO_TARGET_DIR, { recursive: true });
    const projectDir = cli.getProjectDir();
    cpSync(FIXTURE_DIR, projectDir, {
      recursive: true,
      filter: (source) => !source.includes(`${path.sep}target`),
    });
    const command = [
      `bun x ${TAURI_CLI} build --debug --bundles app`,
      "rm -rf ../out && mkdir -p ../out",
      'cp -R "$CARGO_TARGET_DIR/debug/bundle/macos/TauriFixture.app" ../out/',
    ].join(" && ");
    writeFileSync(
      path.join(projectDir, "eas.json"),
      `${JSON.stringify(
        {
          projectType: "native",
          build: {
            tauri: {
              macos: { artifact: "tar.gz", notarize: false },
              custom: {
                macos: {
                  command,
                  cwd: "src-tauri",
                  artifactPath: "../out/*.app",
                  env: TOOLCHAIN_ENV,
                },
              },
            },
          },
        },
        null,
        2,
      )}\n`,
    );
    await cli.bootstrapOrgVault();
    expectSuccess(cli.runCli("init"));
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
    if (workRoot !== "") {
      rmSync(workRoot, { recursive: true, force: true });
    }
  });

  test("builds the app as a Developer ID-signed .app.tar.gz", () => {
    setVersion("1.0.0");
    const output = path.join(workRoot, "TauriFixture-1.0.0.app.tar.gz");
    expectSuccess(build(output, false));
    // What the updater will replace: an installed 1.0.0.
    for (const name of ["static", "dynamic"]) {
      const dir = path.join(installs, name);
      mkdirSync(dir);
      run("tar", ["-xzf", output, "-C", dir]);
      const app = path.join(dir, "TauriFixture.app");
      expect(shortVersionOf(app)).toBe("1.0.0");
      run("codesign", ["--verify", "--deep", "--strict", app]);
      expect(spawnSync("codesign", ["-dvv", app], { encoding: "utf8" }).stderr).toContain(
        "Authority=Developer ID Application:",
      );
    }
    // No AppleDouble `._` entries: they would land inside the installed bundle.
    expect(run("tar", ["-tzf", output])).not.toMatch(/(?:^|\/)\._/mu);
  });

  test("releases 1.1.0 only with the key the app's updater pubkey names", () => {
    setVersion("1.1.0");
    v2Path = path.join(workRoot, "TauriFixture-1.1.0.app.tar.gz");
    const built = build(v2Path, true);
    expectSuccess(built);
    const buildId = buildIdFrom(built.stdout);
    expect(buildId).not.toBe("");

    const unsigned = cli.runCli("macos", "release", "create", buildId, "--file", v2Path);
    expect(unsigned.exitCode).not.toBe(0);
    expect(unsigned.stderr).toContain("only installs updates signed for its updater pubkey");

    const otherKey = path.join(workRoot, "other.key");
    const generated = spawnSync(
      "bun",
      ["x", TAURI_CLI, "signer", "generate", "-w", otherKey, "-p", KEY_PASSWORD, "--ci", "-f"],
      { encoding: "utf8", env: { ...process.env, ...TOOLCHAIN_ENV } },
    );
    expect(generated.status).toBe(0);
    const wrong = cli.runCliWithEnv(
      releaseEnv(otherKey),
      "macos",
      "release",
      "create",
      buildId,
      "--file",
      v2Path,
    );
    expect(wrong.exitCode).not.toBe(0);
    expect(wrong.stderr).toContain("not the one the app's updater pubkey names");

    const released = cli.runCliWithEnv(
      releaseEnv(path.join(FIXTURE_DIR, "updater-test.key")),
      "macos",
      "release",
      "create",
      buildId,
      "--file",
      v2Path,
      "--json",
    );
    expectSuccess(released);
    expect(JSON.parse(released.stdout).data).toMatchObject({
      artifactFormat: "tar.gz",
      appVersion: "1.1.0",
      tauriSigned: true,
    });
  });

  test("an installed 1.0.0 updates itself from the static feed", async () => {
    const endpoint = `${cli.getBaseUrl()}/feeds/${cli.getProjectId()}/macos/latest-tauri.json`;
    const app = path.join(installs, "static", "TauriFixture.app");
    const resultFile = path.join(workRoot, "static-result.txt");
    await expect(runUpdater(app, endpoint, resultFile)).resolves.toBe("1.0.0 installed 1.1.0");
    expect(shortVersionOf(app)).toBe("1.1.0");
    run("codesign", ["--verify", "--deep", "--strict", app]);
    // The replaced app sees nothing newer.
    await expect(runUpdater(app, endpoint, resultFile)).resolves.toBe("1.1.0 none");
  });

  test("an installed 1.0.0 updates itself from the dynamic {{arch}} endpoint", async () => {
    const endpoint = `${cli.getBaseUrl()}/feeds/${cli.getProjectId()}/macos/latest-tauri.json?arch={{arch}}`;
    const app = path.join(installs, "dynamic", "TauriFixture.app");
    const resultFile = path.join(workRoot, "dynamic-result.txt");
    await expect(runUpdater(app, endpoint, resultFile)).resolves.toBe("1.0.0 installed 1.1.0");
    expect(shortVersionOf(app)).toBe("1.1.0");
  });
});
