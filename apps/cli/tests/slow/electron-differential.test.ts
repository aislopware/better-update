import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { setupCliE2E } from "../helpers/cli-e2e";

/**
 * electron-updater's differential download against the real server: two
 * Developer ID zips of one app (a large resource unchanged between them) are
 * released with the blockmaps `macos release create` computes, and
 * electron-updater's own code — `Provider.getBlockMapFiles`, its HTTP
 * executor's blockmap download and `GenericDifferentialDownloader` with
 * multipart range requests — rebuilds the new zip from the old one plus the
 * changed chunks, exactly as an installed app does from its cached
 * `update.zip`.
 *
 * Gated on a real Developer ID .p12 like the other macOS journeys; installs
 * electron-updater from the registry:
 *
 *   E2E_MACOS_DEVELOPER_ID_P12=… E2E_MACOS_DEVELOPER_ID_P12_PASSWORD=… \
 *     bun run test:slow -- tests/slow/electron-differential.test.ts
 */
const P12_PATH = process.env["E2E_MACOS_DEVELOPER_ID_P12"];
const P12_PASSWORD = process.env["E2E_MACOS_DEVELOPER_ID_P12_PASSWORD"];
const canRun =
  process.platform === "darwin" && P12_PATH !== undefined && P12_PASSWORD !== undefined;

const FIXTURE_DIR = path.resolve(import.meta.dirname, "../../../../fixtures/macos-app");
const ELECTRON_UPDATER = "electron-updater@6.8.9";
/** The fixture's SUPublicEDKey belongs to this synthetic seed (see build-macos.test.ts). */
const SPARKLE_SEED = Buffer.alloc(32, 0x2a).toString("base64");
const PAYLOAD_BYTES = 4 * 1024 * 1024;

const APP = "build/dd/Build/Products/Release/MacosFixture.app";
const COMMAND = [
  "xcodebuild -project MacosFixture.xcodeproj -scheme MacosFixture -configuration Release",
  "-derivedDataPath build/dd CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual",
  'MARKETING_VERSION="$FIXTURE_VERSION" CURRENT_PROJECT_VERSION="$FIXTURE_BUILD" build',
  `&& mkdir -p ${APP}/Contents/Resources && cp payload.bin ${APP}/Contents/Resources/payload.bin`,
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

/**
 * What an installed app's updater does, with electron-updater's own modules:
 * read the channel file, derive both blockmap URLs, download them, and
 * rebuild the new zip from the old one.
 */
const CLIENT = String.raw`
const http = require("node:http");
const https = require("node:https");
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { gunzipSync } = require("node:zlib");
const { HttpExecutor, CancellationToken } = require("builder-util-runtime");
const { load } = require("js-yaml");
const { Provider } = require("electron-updater/out/providers/Provider");
const { GenericDifferentialDownloader } = require("electron-updater/out/differentialDownloader/GenericDifferentialDownloader");

class NodeExecutor extends HttpExecutor {
  createRequest(options, callback) {
    return (options.protocol === "https:" ? https : http).request(options, callback);
  }
}

const [feedUrl, oldVersion, oldFile, newFile] = process.argv.slice(2);
const main = async () => {
  const executor = new NodeExecutor();
  const cancellationToken = new CancellationToken();
  const info = load(await (await fetch(feedUrl)).text());
  const [file] = info.files;
  const url = new URL(file.url, feedUrl);
  const [oldUrl, newUrl] = Provider.prototype.getBlockMapFiles(url, oldVersion, info.version);
  const blockmap = async (blockmapUrl) =>
    JSON.parse(gunzipSync(await executor.downloadToBuffer(blockmapUrl, { cancellationToken })).toString());
  const logs = [];
  const logger = { info: (m) => logs.push(String(m)), warn: (m) => logs.push(String(m)), error: (m) => logs.push(String(m)) };
  await new GenericDifferentialDownloader({ size: file.size, sha512: file.sha512 }, executor, {
    newUrl: url,
    oldFile,
    newFile,
    logger,
    requestHeaders: null,
    isUseMultipleRangeRequest: true,
    cancellationToken,
  }).download(await blockmap(oldUrl), await blockmap(newUrl));
  // Evidence on stderr (the run log): electron-updater's "Full: …, To download: …" line.
  console.error(logs.filter((line) => line.includes("To download")).join("\n"));
  const sha512 = createHash("sha512").update(readFileSync(newFile)).digest("base64");
  console.log(JSON.stringify({ version: info.version, sha512, expected: file.sha512, oldUrl: oldUrl.href, logs }));
};
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;

const cli = setupCliE2E("slow-cli-electron-differential", {
  userEmail: "slow-cli-electron-differential@example.com",
  orgSlug: "slow-cli-electron-differential-org",
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

const buildIdFrom = (stdout: string): string =>
  /Build ID\s+(?<id>\S+)/u.exec(stdout)?.groups?.["id"] ?? "";

/** Deterministic incompressible bytes: the resource both versions ship unchanged. */
const payload = () =>
  Buffer.concat(
    Array.from({ length: PAYLOAD_BYTES / 32 }, (_, index) =>
      createHash("sha256")
        .update(`payload ${String(index)}`)
        .digest(),
    ),
  );

describe.skipIf(!canRun)("electron-updater differential download", () => {
  let workRoot = "";
  let clientDir = "";

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
      "--json",
    );
    expectSuccess(released);
    return JSON.parse(released.stdout).data as Record<string, unknown>;
  };

  beforeAll(async () => {
    workRoot = mkdtempSync(path.join(os.tmpdir(), "electron-differential-e2e-"));
    const projectDir = cli.getProjectDir();
    cpSync(FIXTURE_DIR, projectDir, { recursive: true });
    writeFileSync(path.join(projectDir, "payload.bin"), payload());
    writeFileSync(
      path.join(projectDir, "eas.json"),
      `${JSON.stringify(
        {
          projectType: "native",
          build: { "diff-v1": profile("2.0.0", "200"), "diff-v2": profile("2.1.0", "210") },
        },
        null,
        2,
      )}\n`,
    );
    clientDir = path.join(workRoot, "client");
    mkdirSync(clientDir);
    writeFileSync(path.join(clientDir, "package.json"), '{ "private": true }\n');
    execFileSync("bun", ["add", ELECTRON_UPDATER], { cwd: clientDir, stdio: "ignore" });
    writeFileSync(path.join(clientDir, "client.cjs"), CLIENT);

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

  test("downloads only the changed chunks of the new zip", () => {
    const v1Zip = path.join(workRoot, "MacosFixture-2.0.0.zip");
    const v2Zip = path.join(workRoot, "MacosFixture-2.1.0.zip");
    expect(buildAndRelease("diff-v1", v1Zip)).toMatchObject({
      appVersion: "2.0.0",
      blockmap: true,
    });
    expect(buildAndRelease("diff-v2", v2Zip)).toMatchObject({
      appVersion: "2.1.0",
      blockmap: true,
    });
    expect(readFileSync(v2Zip).byteLength).toBeGreaterThan(PAYLOAD_BYTES);

    const rebuilt = path.join(workRoot, "rebuilt.zip");
    const output = execFileSync(
      "node",
      [
        "client.cjs",
        `${cli.getBaseUrl()}/feeds/${cli.getProjectId()}/macos/latest-mac.yml`,
        "2.0.0",
        v1Zip,
        rebuilt,
      ],
      { cwd: clientDir, encoding: "utf8" },
    );
    const result = JSON.parse(output) as {
      version: string;
      sha512: string;
      expected: string;
      oldUrl: string;
      logs: string[];
    };
    expect(result.version).toBe("2.1.0");
    // The old blockmap came from the updater's guess: the new URL with the old version.
    expect(result.oldUrl).toMatch(/\/download\/[^/]+\/MacosFixture-2\.0\.0\.zip\.blockmap$/u);
    // Byte-identical to the released zip, which is what electron-updater verifies.
    expect(result.sha512).toBe(result.expected);
    expect(readFileSync(rebuilt).equals(readFileSync(v2Zip))).toBe(true);
    const share = /To download: .+ \((?<percent>\d+)%\)/u.exec(result.logs.join("\n"))?.groups?.[
      "percent"
    ];
    expect(Number(share)).toBeLessThan(50);
  });
});
