import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { setupCliE2E } from "../helpers/cli-e2e";

/**
 * A real Electron app updating itself on Linux from the real server: the
 * fixture is built twice (1.0.0, 1.1.0) by electron-builder as an AppImage
 * and a deb inside Docker, uploaded with `builds upload --platform linux`,
 * released with `linux release create`, and then installed and run under
 * Xvfb. electron-updater reads `latest-linux-<arch>.yml`, finds nothing newer
 * while only 1.0.0 is released, then downloads 1.1.0 — the AppImage
 * differentially through its embedded blockmap and the Worker's range
 * responses, the deb in full through the R2 redirect — and installs it the way
 * a user's app does (`quitAndInstall`), after which the app reports 1.1.0.
 *
 * Gated on a running Docker daemon. The first run downloads Electron and the
 * electron-builder toolchain into the `better-update-e2e-electron-cache`
 * volume; later runs build in about a minute:
 *
 *   bun run test:slow -- tests/slow/linux-electron-update.test.ts
 *
 * The apps' update logs (electron-updater's own lines, including its
 * differential "Full: …, To download: …" accounting) and the electron-builder
 * logs are kept in `$TMPDIR/better-update-e2e/linux-electron-update/`.
 */
const hasDocker = spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;

const FIXTURE_DIR = path.resolve(import.meta.dirname, "../../../../fixtures/electron-app");
const CACHE_VOLUME = "better-update-e2e-electron-cache";
const PAYLOAD_BYTES = 4 * 1024 * 1024;
const PRODUCT = "Example Electron";
const PACKAGE = "example-electron";
const EVIDENCE_DIR = path.join(os.tmpdir(), "better-update-e2e", "linux-electron-update");
const OLD = "1.0.0";
const NEW = "1.1.0";

const cli = setupCliE2E("slow-cli-linux-electron-update", {
  noExpoConfig: true,
  appJsonTemplate: { expo: { name: "Linux Electron E2E", slug: "linux-electron-e2e" } },
  userEmail: "slow-cli-linux-electron-update@example.com",
  orgSlug: "slow-cli-linux-electron-update-org",
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

/** The image is named after its Dockerfile, so an edited one is rebuilt. */
const imageTag = () =>
  `better-update-e2e/electron-linux:${createHash("sha256")
    .update(readFileSync(path.join(FIXTURE_DIR, "Dockerfile")))
    .digest("hex")
    .slice(0, 12)}`;

const docker = (args: readonly string[], timeoutMs: number) =>
  execFileSync("docker", [...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });

/** Deterministic incompressible bytes both versions ship unchanged. */
const payload = () =>
  Buffer.concat(
    Array.from({ length: PAYLOAD_BYTES / 32 }, (_, index) =>
      createHash("sha256")
        .update(`linux payload ${String(index)}`)
        .digest(),
    ),
  );

const sha512 = (file: string) => createHash("sha512").update(readFileSync(file)).digest("hex");

const BUILD_SCRIPT = String.raw`
set -euo pipefail
cp -r /fixture/. /build/
cd /build
bun install --no-save >/dev/null
for version in ${OLD} ${NEW}; do
  node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("package.json","utf8"));p.version=process.argv[1];fs.writeFileSync("package.json",JSON.stringify(p,null,2))' "$version"
  bunx electron-builder --linux AppImage deb --"$(node -p process.arch)" --publish never >/work/build-$version.log 2>&1
  mkdir -p /work/$version
  cp dist/*.AppImage dist/*.deb /work/$version/
  rm -rf dist
done
`;

describe.skipIf(!hasDocker)("Electron on Linux updates itself from the feed", () => {
  let workRoot = "";
  let feedUrl = "";
  let port = "";

  const artifact = (version: string, extension: string) => {
    const found = readdirSync(path.join(workRoot, version)).find((file) =>
      file.endsWith(extension),
    );
    if (found === undefined) {
      throw new Error(`no ${extension} built for ${version}`);
    }
    return path.join(workRoot, version, found);
  };

  /**
   * Run `script` in the image with a display and the test server's port
   * forwarded to the host. Xvfb is started directly: `xvfb-run` hangs as a
   * container's main process.
   */
  const runInContainer = (script: string) =>
    docker(
      [
        "run",
        "--rm",
        "--init",
        "--add-host=host.docker.internal:host-gateway",
        "-v",
        `${workRoot}:/work`,
        "-e",
        `FEED_URL=${feedUrl}`,
        imageTag(),
        "bash",
        "-c",
        `set -euo pipefail
socat TCP-LISTEN:${port},bind=127.0.0.1,fork,reuseaddr TCP:host.docker.internal:${port} &
Xvfb :99 -screen 0 1280x1024x24 >/dev/null 2>&1 &
export DISPLAY=:99
sleep 1
${script}`,
      ],
      10 * 60 * 1000,
    );

  const writeProject = (version: string) => {
    writeFileSync(
      path.join(cli.getProjectDir(), "package.json"),
      `${JSON.stringify(
        {
          name: PACKAGE,
          productName: PRODUCT,
          version,
          build: { appId: "com.example.electron" },
        },
        null,
        2,
      )}\n`,
    );
  };

  const uploadAndRelease = (version: string) => {
    writeProject(version);
    expectSuccess(
      cli.runCli(
        "builds",
        "upload",
        "--platform",
        "linux",
        artifact(version, ".AppImage"),
        artifact(version, ".deb"),
      ),
    );
    expectSuccess(cli.runCli("linux", "release", "create"));
  };

  beforeAll(
    () => {
      workRoot = mkdtempSync(path.join(os.tmpdir(), "linux-electron-e2e-"));
      ({ port } = new URL(cli.getBaseUrl()));
      // Inside the container 127.0.0.1:<port> is socat, forwarding to the host.
      feedUrl = `http://127.0.0.1:${port}/feeds/${cli.getProjectId()}/linux`;
      writeFileSync(
        path.join(cli.getProjectDir(), "eas.json"),
        `${JSON.stringify({ projectId: cli.getProjectId(), build: { production: { linux: {} } } }, null, 2)}\n`,
      );

      const fixture = path.join(workRoot, "fixture");
      cpSync(FIXTURE_DIR, fixture, { recursive: true });
      writeFileSync(path.join(fixture, "payload.bin"), payload());
      docker(["build", "-q", "-t", imageTag(), FIXTURE_DIR], 20 * 60 * 1000);
      docker(
        [
          "run",
          "--rm",
          "-v",
          `${fixture}:/fixture:ro`,
          "-v",
          `${workRoot}:/work`,
          "-v",
          `${CACHE_VOLUME}:/root/.cache`,
          "--tmpfs",
          "/build:exec,size=4g",
          imageTag(),
          "bash",
          "-c",
          BUILD_SCRIPT,
        ],
        30 * 60 * 1000,
      );
    },
    60 * 60 * 1000,
  );

  afterAll(() => {
    if (workRoot !== "" && existsSync(workRoot)) {
      rmSync(EVIDENCE_DIR, { recursive: true, force: true });
      mkdirSync(EVIDENCE_DIR, { recursive: true });
      for (const name of readdirSync(workRoot).filter((file) => file.endsWith(".log"))) {
        cpSync(path.join(workRoot, name), path.join(EVIDENCE_DIR, name));
      }
      if (existsSync(path.join(workRoot, "logs"))) {
        cpSync(path.join(workRoot, "logs"), EVIDENCE_DIR, { recursive: true });
      }
      rmSync(workRoot, { recursive: true, force: true });
    }
  });

  test("records the packages' architecture, version and embedded blockmap", async () => {
    uploadAndRelease(OLD);
    const channelFile = process.arch === "arm64" ? "latest-linux-arm64.yml" : "latest-linux.yml";
    const response = await cli.get(`/feeds/${cli.getProjectId()}/linux/${channelFile}`);
    const yml = await response.text();
    expect(response.status).toBe(200);
    expect(yml).toContain(`version: "${OLD}"`);
    expect(yml).toMatch(/blockMapSize: \d+/u);
    expect(yml).toContain(".AppImage");
    expect(yml).toContain(".deb");
  });

  test("finds no update while only the installed version is released", () => {
    mkdirSync(path.join(workRoot, "logs"), { recursive: true });
    runInContainer(`
cp "/work/${OLD}/$(ls /work/${OLD} | grep AppImage)" /opt/ExampleElectron.AppImage
chmod +x /opt/ExampleElectron.AppImage
export APPIMAGE_EXTRACT_AND_RUN=1 UPDATE_LOG=/work/logs/no-update.log CHECK_UPDATES=1
/opt/ExampleElectron.AppImage --no-sandbox >/dev/null
`);
    const log = readFileSync(path.join(workRoot, "logs", "no-update.log"), "utf8");
    expect(log).toContain(`version ${OLD}`);
    expect(log).toContain("update-not-available");
  });

  test("updates the AppImage differentially and the new version starts", () => {
    uploadAndRelease(NEW);
    runInContainer(`
cp "/work/${OLD}/$(ls /work/${OLD} | grep AppImage)" /opt/ExampleElectron.AppImage
chmod +x /opt/ExampleElectron.AppImage
export APPIMAGE_EXTRACT_AND_RUN=1 UPDATE_LOG=/work/logs/appimage.log
CHECK_UPDATES=1 /opt/ExampleElectron.AppImage --no-sandbox >/dev/null || true
CHECK_UPDATES=0 /opt/ExampleElectron.AppImage --no-sandbox >/dev/null
sha512sum /opt/ExampleElectron.AppImage | cut -d' ' -f1 > /work/logs/appimage.sha512
`);
    const log = readFileSync(path.join(workRoot, "logs", "appimage.log"), "utf8");
    expect(log).toContain(`update-downloaded ${NEW}`);
    expect(log).not.toContain("fallback to full download");
    const percent = /To download: [^(]*\((?<percent>\d+)%\)/u.exec(log)?.groups?.["percent"];
    expect(Number(percent)).toBeLessThan(50);
    // The installed file is now the released 1.1.0 AppImage, and it runs.
    expect(readFileSync(path.join(workRoot, "logs", "appimage.sha512"), "utf8").trim()).toBe(
      sha512(artifact(NEW, ".AppImage")),
    );
    expect(log.trim().split("\n").at(-1)).toBe(`version ${NEW}`);
  });

  test("updates the installed deb through dpkg and the new version starts", () => {
    runInContainer(`
dpkg -i "/work/${OLD}/$(ls /work/${OLD} | grep '\\.deb$')" >/dev/null
APP="/opt/${PRODUCT}/${PACKAGE}"
export UPDATE_LOG=/work/logs/deb.log
CHECK_UPDATES=1 "$APP" --no-sandbox >/dev/null || true
dpkg-query -W -f='\${Version}' ${PACKAGE} > /work/logs/deb.version
CHECK_UPDATES=0 "$APP" --no-sandbox >/dev/null
`);
    const log = readFileSync(path.join(workRoot, "logs", "deb.log"), "utf8");
    expect(log).toContain(`update-downloaded ${NEW}`);
    expect(readFileSync(path.join(workRoot, "logs", "deb.version"), "utf8")).toBe(NEW);
    expect(log.trim().split("\n").at(-1)).toBe(`version ${NEW}`);
  });
});
