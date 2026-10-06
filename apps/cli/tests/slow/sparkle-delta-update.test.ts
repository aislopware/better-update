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
 * A Sparkle app updating itself through a binary delta from the real server:
 * the macOS fixture, with Sparkle's framework embedded, is built and signed
 * twice by `build --platform macos`; `macos release create` makes the second
 * release's delta from the first with Sparkle's BinaryDelta, signs and
 * uploads it; and `sparkle-cli` (Sparkle 2.8.1, the last release that ships
 * it) — Sparkle's own updater, driving an installed 3.0.0 — reads the
 * appcast, downloads the delta instead of the archive, verifies its EdDSA
 * signature, patches the bundle and installs 3.1.0.
 *
 * Gated on a real Developer ID .p12 like the other macOS journeys:
 *
 *   E2E_MACOS_DEVELOPER_ID_P12=… E2E_MACOS_DEVELOPER_ID_P12_PASSWORD=… \
 *     bun run test:slow -- tests/slow/sparkle-delta-update.test.ts
 *
 * sparkle-cli's output is kept in `$TMPDIR/better-update-e2e/sparkle-delta-update/`.
 */
const P12_PATH = process.env["E2E_MACOS_DEVELOPER_ID_P12"];
const P12_PASSWORD = process.env["E2E_MACOS_DEVELOPER_ID_P12_PASSWORD"];
const canRun =
  process.platform === "darwin" && P12_PATH !== undefined && P12_PASSWORD !== undefined;

const FIXTURE_DIR = path.resolve(import.meta.dirname, "../../../../fixtures/macos-app");
/** The fixture's SUPublicEDKey belongs to this synthetic seed (see build-macos.test.ts). */
const SPARKLE_SEED = Buffer.alloc(32, 0x2a).toString("base64");
const PAYLOAD_BYTES = 4 * 1024 * 1024;
const EVIDENCE_DIR = path.join(os.tmpdir(), "better-update-e2e", "sparkle-delta-update");
const CACHE_DIR = path.join(os.homedir(), ".cache", "better-update-e2e", "sparkle");

/** The framework the app embeds, and the release whose sparkle-cli updates it. */
const SPARKLE = {
  framework: {
    version: "2.10.0",
    sha256: "c2bf58aa8387266ac179357b1415d6f2635f044da8be41042af32425dae6da0c",
  },
  client: {
    version: "2.8.1",
    sha256: "5cddb7695674ef7704268f38eccaee80e3accbf19e61c1689efff5b6116d85be",
  },
} as const;

const APP = "build/dd/Build/Products/Release/MacosFixture.app";
const COMMAND = [
  "xcodebuild -project MacosFixture.xcodeproj -scheme MacosFixture -configuration Release",
  "-derivedDataPath build/dd CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual",
  'MARKETING_VERSION="$FIXTURE_VERSION" CURRENT_PROJECT_VERSION="$FIXTURE_BUILD" build',
  `&& mkdir -p ${APP}/Contents/Resources ${APP}/Contents/Frameworks`,
  `&& cp payload.bin ${APP}/Contents/Resources/payload.bin`,
  `&& ditto Sparkle.framework ${APP}/Contents/Frameworks/Sparkle.framework`,
].join(" ");

const profile = (version: string, build: string) => ({
  macos: { artifact: "zip", notarize: false },
  custom: {
    macos: {
      command: COMMAND,
      artifactPath: APP,
      env: { FIXTURE_VERSION: version, FIXTURE_BUILD: build },
    },
  },
});

const cli = setupCliE2E("slow-cli-sparkle-delta", {
  userEmail: "slow-cli-sparkle-delta@example.com",
  orgSlug: "slow-cli-sparkle-delta-org",
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
        .update(`sparkle payload ${String(index)}`)
        .digest(),
    ),
  );

/** A Sparkle release, downloaded once and checked against its pinned SHA-256. */
const sparkleRelease = (release: { readonly version: string; readonly sha256: string }) => {
  const dir = path.join(CACHE_DIR, release.version);
  if (existsSync(path.join(dir, "Sparkle.framework"))) {
    return dir;
  }
  mkdirSync(dir, { recursive: true });
  const archive = path.join(dir, "Sparkle.tar.xz");
  execFileSync("curl", [
    "-fsSL",
    "-o",
    archive,
    `https://github.com/sparkle-project/Sparkle/releases/download/${release.version}/Sparkle-${release.version}.tar.xz`,
  ]);
  expect(createHash("sha256").update(readFileSync(archive)).digest("hex")).toBe(release.sha256);
  execFileSync("tar", ["-xf", archive, "-C", dir]);
  rmSync(archive);
  return dir;
};

const bundleVersion = (app: string) =>
  execFileSync(
    "/usr/libexec/PlistBuddy",
    ["-c", "Print CFBundleVersion", path.join(app, "Contents", "Info.plist")],
    { encoding: "utf8" },
  ).trim();

describe.skipIf(!canRun)("Sparkle updates an installed app through a binary delta", () => {
  let workRoot = "";
  let sparkleCli = "";
  let deltaLength = "";
  let archiveLength = 0;

  const buildAndRelease = (profileName: string, output: string) => {
    const built = cli.runCli(
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
    const released = cli.runCliWithEnv(
      { SPARKLE_PRIVATE_KEY: SPARKLE_SEED },
      "macos",
      "release",
      "create",
      buildIdFrom(built.stdout),
      "--file",
      output,
    );
    expectSuccess(released);
    return released.stdout;
  };

  beforeAll(async () => {
    workRoot = mkdtempSync(path.join(os.tmpdir(), "sparkle-delta-e2e-"));
    const projectDir = cli.getProjectDir();
    cpSync(FIXTURE_DIR, projectDir, { recursive: true });
    writeFileSync(path.join(projectDir, "payload.bin"), payload());
    execFileSync("ditto", [
      path.join(sparkleRelease(SPARKLE.framework), "Sparkle.framework"),
      path.join(projectDir, "Sparkle.framework"),
    ]);
    sparkleCli = path.join(
      sparkleRelease(SPARKLE.client),
      "sparkle.app",
      "Contents",
      "MacOS",
      "sparkle",
    );
    writeFileSync(
      path.join(projectDir, "eas.json"),
      `${JSON.stringify(
        {
          projectType: "native",
          build: { "sparkle-v1": profile("3.0.0", "300"), "sparkle-v2": profile("3.1.0", "310") },
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

  test("releasing 3.1.0 makes, signs and lists a delta from 3.0.0", async () => {
    const v1Zip = path.join(workRoot, "MacosFixture-3.0.0.zip");
    const v2Zip = path.join(workRoot, "MacosFixture-3.1.0.zip");
    const first = buildAndRelease("sparkle-v1", v1Zip);
    expect(first).not.toContain("Sparkle delta");
    const second = buildAndRelease("sparkle-v2", v2Zip);
    const percent =
      /Uploaded the Sparkle delta from 300: (?<percent>\d+)% of the full archive/u.exec(second)
        ?.groups?.["percent"];
    expect(Number(percent)).toBeLessThan(25);

    const feed = await cli.get(`/feeds/${cli.getProjectId()}/macos/appcast.xml`);
    const appcast = await feed.text();
    const delta =
      /<sparkle:deltas>\s*<enclosure url="[^"]+\/delta\/[^"]+\.delta" sparkle:deltaFrom="300" length="(?<length>\d+)" type="application\/octet-stream" sparkle:deltaFromSparkleExecutableSize="\d+" sparkle:deltaFromSparkleLocales="[^"]+" sparkle:edSignature="[^"]+"\/>\s*<\/sparkle:deltas>/u.exec(
        appcast,
      );
    deltaLength = delta?.groups?.["length"] ?? "";
    expect(deltaLength).not.toBe("");
    archiveLength = readFileSync(v2Zip).byteLength;

    // A second release of the same build reuses the stored delta.
    const again = cli.runCliWithEnv(
      { SPARKLE_PRIVATE_KEY: SPARKLE_SEED },
      "macos",
      "release",
      "create",
      "--channel",
      "beta",
      "--file",
      v2Zip,
    );
    expect(again.stdout).not.toContain("Uploaded the Sparkle delta");
  });

  test("sparkle-cli installs 3.1.0 over 3.0.0 from the delta", () => {
    const install = path.join(workRoot, "Applications");
    mkdirSync(install);
    execFileSync("ditto", ["-x", "-k", path.join(workRoot, "MacosFixture-3.0.0.zip"), install]);
    const app = path.join(install, "MacosFixture.app");
    expect(bundleVersion(app)).toBe("300");

    const run = spawnSync(
      sparkleCli,
      [
        app,
        "--check-immediately",
        "--feed-url",
        `${cli.getBaseUrl()}/feeds/${cli.getProjectId()}/macos/appcast.xml`,
        "--user-agent-name",
        "better-update-e2e",
        "--verbose",
      ],
      { encoding: "utf8", timeout: 5 * 60 * 1000 },
    );
    rmSync(EVIDENCE_DIR, { recursive: true, force: true });
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    writeFileSync(path.join(EVIDENCE_DIR, "sparkle-cli.log"), `${run.stdout}\n${run.stderr}`);
    expect(run.status).toBe(0);
    expect(bundleVersion(app)).toBe("310");
    // Sparkle downloaded the delta, not the archive.
    // sparkle-cli reports progress on stderr.
    expect(run.stderr).toContain(`Downloading ${deltaLength} bytes...`);
    expect(Number(deltaLength)).toBeLessThan(archiveLength / 10);
    // The patched bundle is the released one: still validly signed, payload intact.
    execFileSync("codesign", ["--verify", "--deep", "--strict", app]);
    expect(
      readFileSync(path.join(app, "Contents", "Resources", "payload.bin")).equals(payload()),
    ).toBe(true);
  });
});
