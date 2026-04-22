import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { setupCliE2E } from "../helpers/cli-e2e";

// Gated on ANDROID_HOME because gradlew requires a functioning Android SDK
// Toolchain; the build-credentials resolve endpoint is covered in the server
// E2E suite independently.
const hasAndroidSdk = Boolean(process.env["ANDROID_HOME"]);

const FIXTURE_DIR = path.resolve(import.meta.dirname, "../../../../fixtures/build-e2e-app");

const buildAppJsonTemplate = {
  expo: {
    name: "E2E Build App",
    slug: "e2e-build-app",
    owner: "e2e-build",
    version: "1.0.0",
    runtimeVersion: "1.0.0",
    ios: {
      bundleIdentifier: "com.example.e2ebuild",
      buildNumber: "1",
    },
    android: {
      package: "com.example.e2ebuild",
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

const KEYSTORE_PASSWORD = "e2epass123";
const KEY_ALIAS = "e2e-key";
const KEY_PASSWORD = "e2epass123";

const cli = setupCliE2E(".wrangler/state/e2e-cli-build", {
  projectDir: FIXTURE_DIR,
  appJsonTemplate: buildAppJsonTemplate,
});

const buildState = {
  buildId: "",
  expectedByteSize: 0,
  expectedSha256: "",
  prebuiltArtifactPath: "",
  prebuiltSha256: "",
  prebuiltByteSize: 0,
  reuploadedBuildId: "",
};

describe.skipIf(!hasAndroidSdk)("CLI build journey — Android", () => {
  beforeAll(async () => {
    if (!hasAndroidSdk) {
      return;
    }
    // Generate a self-signed Android keystore for signing the build.
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "build-e2e-keystore-"));
    const keystorePath = path.join(tmpDir, "e2e.keystore");

    execFileSync(
      "keytool",
      [
        "-genkeypair",
        "-v",
        "-keystore",
        keystorePath,
        "-alias",
        KEY_ALIAS,
        "-keyalg",
        "RSA",
        "-keysize",
        "2048",
        "-validity",
        "365",
        "-storepass",
        KEYSTORE_PASSWORD,
        "-keypass",
        KEY_PASSWORD,
        "-dname",
        "CN=E2E Test, O=Better Update",
      ],
      { stdio: "pipe" },
    );

    const keystoreBlob = readFileSync(keystorePath).toString("base64");
    rmSync(tmpDir, { recursive: true, force: true });

    // Seed keystore credential on the test server via new typed endpoint.
    const createResponse = await cli.postAuthorized("/api/android/upload-keystores", {
      keystoreBase64: keystoreBlob,
      keyAlias: KEY_ALIAS,
      keystorePassword: KEYSTORE_PASSWORD,
      keyPassword: KEY_PASSWORD,
    });
    expect(createResponse.status).toBe(201);
    const createBody = await createResponse.json();
    const keystoreId = createBody.id as string;

    // Register Android application identifier + default build credentials group so the
    // Resolve endpoint can find a keystore binding for package name.
    const appResponse = await cli.postAuthorized(
      `/api/projects/${cli.getProjectId()}/android-application-identifiers`,
      { packageName: "com.example.e2ebuild" },
    );
    expect(appResponse.status).toBe(201);
    const appBody = await appResponse.json();
    const appId = appBody.id as string;

    const groupResponse = await cli.postAuthorized(
      `/api/android-application-identifiers/${appId}/build-credentials`,
      {
        name: "Default",
        isDefault: true,
        androidUploadKeystoreId: keystoreId,
      },
    );
    expect(groupResponse.status).toBe(201);
  });

  test("links the fixture app to the seeded project", () => {
    const result = cli.runCli("init");
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Linking project: E2E Build App (e2e-build-app)");
    expect(result.stdout).toContain("Found existing project: E2E Build App Project");
    expect(result.stdout).toContain("Project linked successfully");

    const appJson = cli.readAppJson();
    const expo = appJson["expo"] as Record<string, unknown>;
    const extra = expo["extra"] as Record<string, unknown>;
    const betterUpdate = extra["betterUpdate"] as Record<string, unknown>;
    expect(betterUpdate["projectId"]).toBe(cli.getProjectId());
  });

  test("builds an Android APK and uploads it", () => {
    const result = cli.runCli("build", "--platform", "android", "--message", "E2E Android build");
    expect(result.exitCode).toBe(0);

    // Build workflow prints artifact path before upload.
    expect(result.stdout).toContain("Artifact produced:");

    // After upload, key-value summary is printed.
    const buildIdMatch = /^Build ID\s+(.+)$/m.exec(result.stdout);
    expect(buildIdMatch).toBeDefined();
    buildState.buildId = buildIdMatch![1]!.trim();

    expect(result.stdout).toMatch(/^Status\s+uploaded$/m);
    expect(result.stdout).toMatch(/^Platform\s+android$/m);
    expect(result.stdout).toMatch(/^Profile\s+production$/m);
    expect(result.stdout).toMatch(/^Runtime version\s+1\.0\.0$/m);
    expect(result.stdout).toMatch(/^SHA-256\s+[a-f0-9]{64}$/m);
    expect(result.stdout).toMatch(/^Bytes\s+\d+$/m);
  }, 600_000);

  test("lists the uploaded build via CLI", () => {
    expect(buildState.buildId).not.toBe("");

    const result = cli.runCli("builds", "list");
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(buildState.buildId);
    expect(result.stdout).toContain("android");
    expect(result.stdout).toContain("production");
    expect(result.stdout).toContain("direct");
  });

  test("gets build details via CLI", () => {
    const result = cli.runCli("builds", "get", buildState.buildId);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatch(/^Platform\s+android$/m);
    expect(result.stdout).toMatch(/^Profile\s+production$/m);
    expect(result.stdout).toMatch(/^Distribution\s+direct$/m);
    expect(result.stdout).toMatch(/^Runtime Version\s+1\.0\.0$/m);
    expect(result.stdout).toMatch(/^Bundle ID\s+com\.example\.e2ebuild$/m);
    expect(result.stdout).toMatch(/^Message\s+E2E Android build$/m);
    expect(result.stdout).toContain("apk");
  });

  test("verifies build metadata in API", async () => {
    const response = await cli.getAuthorized(`/api/builds/${buildState.buildId}`);
    expect(response.status).toBe(200);

    const build = (await response.json()) as {
      id: string;
      platform: string;
      profile: string;
      distribution: string;
      runtimeVersion: string;
      bundleId: string;
      message: string;
      artifact: { format: string; byteSize: number; sha256: string } | null;
    };

    expect(build.id).toBe(buildState.buildId);
    expect(build.platform).toBe("android");
    expect(build.profile).toBe("production");
    expect(build.distribution).toBe("direct");
    expect(build.runtimeVersion).toBe("1.0.0");
    expect(build.bundleId).toBe("com.example.e2ebuild");
    expect(build.message).toBe("E2E Android build");
    expect(build.artifact).not.toBeNull();
    expect(build.artifact!.format).toBe("apk");
    expect(build.artifact!.byteSize).toBeGreaterThan(0);
    expect(build.artifact!.sha256).toMatch(/^[a-f0-9]{64}$/);

    buildState.expectedByteSize = build.artifact!.byteSize;
    buildState.expectedSha256 = build.artifact!.sha256;
  });

  test("gets install link for the build", () => {
    const result = cli.runCli("builds", "install-link", buildState.buildId);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatch(/^Artifact URL\s+http.+$/m);
    // Android direct distribution has no itms-services install URL.
    expect(result.stdout).toMatch(/^Install URL\s+-$/m);
  });

  test("downloads the uploaded artifact and verifies its integrity", async () => {
    expect(buildState.expectedByteSize).toBeGreaterThan(0);
    expect(buildState.expectedSha256).not.toBe("");

    // Get a fresh artifact URL via the API.
    const linkResponse = await cli.getAuthorized(`/api/builds/${buildState.buildId}/install-link`);
    expect(linkResponse.status).toBe(200);
    const { artifactUrl } = (await linkResponse.json()) as { artifactUrl: string };

    // Download the full artifact binary.
    const downloadResponse = await fetch(artifactUrl);
    expect(downloadResponse.status).toBe(200);

    const body = Buffer.from(await downloadResponse.arrayBuffer());
    expect(body.byteLength).toBe(buildState.expectedByteSize);

    const actualSha256 = createHash("sha256").update(body).digest("hex");
    expect(actualSha256).toBe(buildState.expectedSha256);
  });

  test("deletes the build and confirms removal", () => {
    const deleteResult = cli.runCli("builds", "delete", buildState.buildId);
    expect(deleteResult.exitCode).toBe(0);
    expect(deleteResult.stderr).toBe("");
    expect(deleteResult.stdout).toContain(`Build ${buildState.buildId} deleted.`);

    const listResult = cli.runCli("builds", "list");
    expect(listResult.exitCode).toBe(0);
    expect(listResult.stdout).not.toContain(buildState.buildId);
  });

  test("builds with --no-upload and skips the upload step", () => {
    const result = cli.runCli("build", "--platform", "android", "--no-upload");
    expect(result.exitCode).toBe(0);

    expect(result.stdout).toContain("Artifact produced:");
    expect(result.stdout).toMatch(/^Artifact\s+.+\.apk$/m);
    expect(result.stdout).toMatch(/^SHA-256\s+[a-f0-9]{64}$/m);
    expect(result.stdout).toMatch(/^Bytes\s+\d+$/m);
    expect(result.stdout).toMatch(/^Upload\s+skipped \(--no-upload\)$/m);

    const artifactMatch = /^Artifact\s+(.+\.apk)\s*$/m.exec(result.stdout);
    expect(artifactMatch).not.toBeNull();
    const sha256Match = /^SHA-256\s+([a-f0-9]{64})\s*$/m.exec(result.stdout);
    expect(sha256Match).not.toBeNull();
    const bytesMatch = /^Bytes\s+(\d+)\s*$/m.exec(result.stdout);
    expect(bytesMatch).not.toBeNull();

    buildState.prebuiltArtifactPath = artifactMatch![1]!.trim();
    buildState.prebuiltSha256 = sha256Match![1]!.trim();
    buildState.prebuiltByteSize = Number(bytesMatch![1]!.trim());
  }, 600_000);

  test("uploads a pre-built artifact via `builds upload`", () => {
    expect(buildState.prebuiltArtifactPath).not.toBe("");

    const result = cli.runCli(
      "builds",
      "upload",
      buildState.prebuiltArtifactPath,
      "--platform",
      "android",
      "--message",
      "E2E upload-only",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");

    const buildIdMatch = /^Build ID\s+(.+)$/m.exec(result.stdout);
    expect(buildIdMatch).not.toBeNull();
    buildState.reuploadedBuildId = buildIdMatch![1]!.trim();
    expect(buildState.reuploadedBuildId).not.toBe("");

    expect(result.stdout).toMatch(/^Status\s+uploaded$/m);
    expect(result.stdout).toMatch(/^Platform\s+android$/m);
    expect(result.stdout).toMatch(/^Profile\s+production$/m);
    expect(result.stdout).toMatch(new RegExp(`^SHA-256\\s+${buildState.prebuiltSha256}$`, "m"));
    expect(result.stdout).toMatch(new RegExp(`^Bytes\\s+${buildState.prebuiltByteSize}$`, "m"));
  }, 600_000);

  test("reuploaded build is visible via API with matching artifact", async () => {
    expect(buildState.reuploadedBuildId).not.toBe("");

    const response = await cli.getAuthorized(`/api/builds/${buildState.reuploadedBuildId}`);
    expect(response.status).toBe(200);
    const build = (await response.json()) as {
      id: string;
      platform: string;
      distribution: string;
      message: string;
      artifact: { format: string; byteSize: number; sha256: string } | null;
    };
    expect(build.id).toBe(buildState.reuploadedBuildId);
    expect(build.platform).toBe("android");
    expect(build.distribution).toBe("direct");
    expect(build.message).toBe("E2E upload-only");
    expect(build.artifact).not.toBeNull();
    expect(build.artifact!.format).toBe("apk");
    expect(build.artifact!.byteSize).toBe(buildState.prebuiltByteSize);
    expect(build.artifact!.sha256).toBe(buildState.prebuiltSha256);
  });
});
