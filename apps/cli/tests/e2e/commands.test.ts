import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { generateIdentity } from "@better-update/credentials-crypto";

import { setupCliE2E } from "../helpers/cli-e2e";

const generateSelfSignedP12 = (password: string, subject: string): Buffer => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-p12-"));
  const keyPath = path.join(tmp, "key.pem");
  const certPath = path.join(tmp, "cert.pem");
  const p12Path = path.join(tmp, "cert.p12");
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-sha256",
        "-days",
        "365",
        "-nodes",
        "-keyout",
        keyPath,
        "-out",
        certPath,
        "-subj",
        subject,
      ],
      { stdio: "pipe" },
    );
    execFileSync(
      "openssl",
      [
        "pkcs12",
        "-export",
        "-out",
        p12Path,
        "-inkey",
        keyPath,
        "-in",
        certPath,
        "-passout",
        `pass:${password}`,
        "-legacy",
      ],
      { stdio: "pipe" },
    );
    return readFileSync(p12Path);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
};

const cli = setupCliE2E("e2e-cli-commands", {
  userEmail: "cli-e2e-commands@example.com",
  orgSlug: "cli-e2e-commands-org",
});

const escapeRegExp = (value: string) => value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
const sqlString = (value: string) => `'${value.replaceAll("'", "''")}'`;

const getNodeErrorCode = (error: unknown): string | undefined => {
  if (!(error instanceof Error)) {
    return undefined;
  }

  const directCode = (error as NodeJS.ErrnoException).code;
  if (typeof directCode === "string") {
    return directCode;
  }

  const { cause } = error as Error & { readonly cause?: unknown };
  if (typeof cause !== "object" || cause === null) {
    return undefined;
  }

  const nestedCode = (cause as NodeJS.ErrnoException).code;
  return typeof nestedCode === "string" ? nestedCode : undefined;
};

const fetchWithRetry = async (url: string, init: RequestInit): Promise<Response> => {
  const maxAttempts = 4;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fetch(url, init);
    } catch (error) {
      const code = getNodeErrorCode(error);
      if (
        !code ||
        !["ECONNRESET", "EPIPE", "UND_ERR_SOCKET"].includes(code) ||
        attempt === maxAttempts
      ) {
        throw error;
      }

      await sleep(attempt * 100);
    }
  }

  throw new Error("fetchWithRetry exhausted unexpectedly");
};

const seedDestinationChannel = (name: string) => {
  const branchId = `${name}-branch`;
  const channelId = `${name}-channel`;
  cli.seedSql(`
INSERT INTO "branches" ("id", "project_id", "name", "created_at")
VALUES (${sqlString(branchId)}, ${sqlString(cli.getProjectId())}, ${sqlString(name)}, '2026-04-14T00:00:00Z');

INSERT INTO "channels" (
  "id", "project_id", "name", "branch_id", "branch_mapping_json", "cache_version", "is_paused", "created_at"
)
VALUES (
  ${sqlString(channelId)},
  ${sqlString(cli.getProjectId())},
  ${sqlString(name)},
  ${sqlString(branchId)},
  NULL,
  0,
  0,
  '2026-04-14T00:00:00Z'
);
`);
};

interface PromotableUpdate {
  readonly id: string;
  readonly groupId: string;
  readonly assetHash: string;
  readonly launchAssetKey: string;
}

const createPromotableUpdate = async (options?: {
  readonly signed?: {
    readonly manifestId: string;
    readonly createdAt: string;
    readonly signature: string;
    readonly certificateChain: string;
  };
}): Promise<PromotableUpdate> => {
  const assetBody = Buffer.from("console.log('cli promote source');\n");
  const assetHash = createHash("sha256").update(assetBody).digest("base64url");
  const launchAssetKey = "bundles/ios-launch.js";
  const registerResponse = await cli.postAuthorized("/api/assets/upload", {
    projectId: cli.getProjectId(),
    assets: [{ hash: assetHash, contentType: "application/javascript", fileExt: "js" }],
  });
  expect(registerResponse.status).toBe(201);

  const registerBody = (await registerResponse.json()) as {
    uploaded: {
      hash: string;
      uploadUrl: string;
      uploadHeaders: Record<string, string>;
    }[];
    deduplicated: string[];
  };
  const upload = registerBody.uploaded.find((asset) => asset.hash === assetHash);
  if (upload) {
    const uploadResponse = await fetchWithRetry(upload.uploadUrl, {
      method: "PUT",
      headers: {
        "content-length": String(assetBody.byteLength),
        ...upload.uploadHeaders,
      },
      body: assetBody,
    });
    expect(uploadResponse.status).toBe(200);

    const finalizeResponse = await cli.postAuthorized(
      `/api/assets/${assetHash}/finalize`,
      undefined,
    );
    expect(finalizeResponse.status).toBe(200);
  } else {
    expect(registerBody.deduplicated).toContain(assetHash);
  }

  const manifestBody =
    options?.signed === undefined
      ? undefined
      : JSON.stringify({
          id: options.signed.manifestId,
          createdAt: options.signed.createdAt,
          runtimeVersion: "1.0.0",
          launchAsset: { key: launchAssetKey, hash: assetHash },
          assets: [],
        });

  const createUpdateResponse = await cli.postAuthorized("/api/updates", {
    branch: "main",
    slug: "cli-e2e-app",
    runtimeVersion: "1.0.0",
    platform: "ios",
    message: options?.signed ? "CLI signed promotable update" : "CLI promotable update",
    groupId: randomUUID(),
    metadata: {},
    assets: [{ hash: assetHash, key: launchAssetKey, isLaunch: true }],
    ...(manifestBody
      ? {
          manifestBody,
          signature: options?.signed?.signature,
          certificateChain: options?.signed?.certificateChain,
        }
      : {}),
  });
  expect(createUpdateResponse.status).toBe(201);

  const update = (await createUpdateResponse.json()) as {
    id: string;
    groupId: string;
  };

  return {
    id: update.id,
    groupId: update.groupId,
    assetHash,
    launchAssetKey,
  };
};

const cliState = {
  rollbackGroupId: "",
  rollbackUpdateId: "",
};

describe("cLI command journey", () => {
  // Bootstrap the org vault once for the whole journey — env var values and
  // credentials are both sealed under it. Driven non-interactively via
  // BETTER_UPDATE_IDENTITY (the CI identity path: a raw age key, no passphrase).
  let credsEnv: Record<string, string> = {};
  beforeAll(async () => {
    const identity = await generateIdentity();
    credsEnv = { BETTER_UPDATE_IDENTITY: identity.privateKey };
    const init = cli.runCliWithEnv(
      credsEnv,
      "credentials",
      "identity",
      "init",
      "--label",
      "CI Machine",
    );
    expect(init.exitCode).toBe(0);
    expect(init.stdout).toContain("vault bootstrapped");
  });

  it("links the current Expo app to the existing project", () => {
    const result = cli.runCli("init");
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Linking project: CLI E2E App (cli-e2e-app)");
    expect(result.stdout).toContain("Found existing project: CLI E2E App Project");
    expect(result.stdout).toContain("Project linked successfully");

    const appJson = cli.readAppJson();
    expect(
      (
        ((appJson["expo"] as Record<string, unknown>)["extra"] as Record<string, unknown>)[
          "betterUpdate"
        ] as Record<string, unknown>
      )["projectId"],
    ).toBe(cli.getProjectId());
  });

  it("shows project status with credential and build counts", () => {
    const result = cli.runCli("status");
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Project");
    expect(result.stdout).toContain("CLI E2E App Project");
    expect(result.stdout).toContain("cli-e2e-app");
    expect(result.stdout).toContain("Credentials");
    expect(result.stdout).toContain("iOS");
    expect(result.stdout).toContain("1");
    expect(result.stdout).toContain("Builds");
  });

  it("lists credentials for an empty project", () => {
    const result = cli.runCli("credentials", "list");
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("No credentials found.");
  });

  it("seals, lists (metadata only), pulls, versions, and deletes env vars via the vault", () => {
    // import seals each value client-side under the vault; pull/export/get decrypt.
    const envFile = path.join(cli.getProjectDir(), ".env.preview");
    writeFileSync(envFile, "EXPO_PUBLIC_API_URL=https://preview.example.com\nFEATURE_FLAG=true\n");

    const importResult = cli.runCliWithEnv(
      credsEnv,
      "env",
      "import",
      envFile,
      "--environment",
      "preview",
    );
    expect(importResult.exitCode).toBe(0);
    expect(importResult.stdout).toContain("Imported: 2 created, 0 updated, 0 skipped");

    // pull decrypts the sealed values back — the round-trip through the vault.
    const pullResult = cli.runCliWithEnv(credsEnv, "env", "pull", "--environment", "preview");
    expect(pullResult.exitCode).toBe(0);
    expect(pullResult.stdout).toContain("Wrote 2 env vars to");
    const pulledDotenv = readFileSync(path.join(cli.getProjectDir(), ".env.local"), "utf8");
    expect(pulledDotenv).toContain('EXPO_PUBLIC_API_URL="https://preview.example.com"');
    expect(pulledDotenv).toContain('FEATURE_FLAG="true"');

    const exportResult = cli.runCliWithEnv(credsEnv, "env", "export", "--environment", "preview");
    expect(exportResult.exitCode).toBe(0);
    expect(exportResult.stdout).toContain("EXPO_PUBLIC_API_URL='https://preview.example.com'");

    // set then change the value → two revisions.
    const createResult = cli.runCliWithEnv(
      credsEnv,
      "env",
      "set",
      "APP_PUBLIC_URL=https://app.example.com",
      "--environment",
      "production",
    );
    expect(createResult.exitCode).toBe(0);
    expect(createResult.stdout).toContain("Set APP_PUBLIC_URL");
    expect(createResult.stdout).toContain("1 created");

    const updateResult = cli.runCliWithEnv(
      credsEnv,
      "env",
      "set",
      "APP_PUBLIC_URL=https://app-v2.example.com",
      "--environment",
      "production",
    );
    expect(updateResult.exitCode).toBe(0);
    expect(updateResult.stdout).toContain("1 updated");

    const getResult = cli.runCliWithEnv(
      credsEnv,
      "env",
      "get",
      "APP_PUBLIC_URL",
      "--environment",
      "production",
    );
    expect(getResult.exitCode).toBe(0);
    expect(getResult.stdout).toContain("https://app-v2.example.com");

    // history lists the revisions; roll back to the first and confirm via get.
    const historyResult = cli.runCliWithEnv(
      credsEnv,
      "env",
      "history",
      "APP_PUBLIC_URL",
      "--environment",
      "production",
    );
    expect(historyResult.exitCode).toBe(0);
    expect(historyResult.stdout).toContain("current");

    const rollbackResult = cli.runCliWithEnv(
      credsEnv,
      "env",
      "rollback",
      "APP_PUBLIC_URL",
      "--to",
      "1",
      "--environment",
      "production",
    );
    expect(rollbackResult.exitCode).toBe(0);
    expect(rollbackResult.stdout).toContain("Rolled back APP_PUBLIC_URL");

    const afterRollback = cli.runCliWithEnv(
      credsEnv,
      "env",
      "get",
      "APP_PUBLIC_URL",
      "--environment",
      "production",
    );
    expect(afterRollback.stdout).toContain("https://app.example.com");

    // list shows metadata only — never the decrypted value (read-only/no vault).
    const listResult = cli.runCli("env", "list", "--environments", "production");
    expect(listResult.exitCode).toBe(0);
    expect(listResult.stdout).toContain("APP_PUBLIC_URL");
    expect(listResult.stdout).not.toContain("https://app.example.com");

    const deleteResult = cli.runCli(
      "env",
      "delete",
      "APP_PUBLIC_URL",
      "--environment",
      "production",
    );
    expect(deleteResult.exitCode).toBe(0);
    expect(deleteResult.stdout).toContain("Deleted APP_PUBLIC_URL");

    const finalList = cli.runCli("env", "list", "--environments", "production");
    expect(finalList.exitCode).toBe(0);
    expect(finalList.stdout).not.toContain("APP_PUBLIC_URL");
  });

  it("lists builds for the linked project", () => {
    const result = cli.runCli("builds", "list");
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(cli.getSeededBuildId());
    expect(result.stdout).toContain("ad-hoc");
    expect(result.stdout).toContain("production");
  });

  it("creates a rollback update from the CLI", async () => {
    const commitTime = "2026-04-14T00:00:00.000Z";
    const rollbackResult = cli.runCli(
      "update",
      "rollback",
      "--branch",
      "main",
      "--platform",
      "ios",
      "--commit-time",
      commitTime,
    );

    expect(rollbackResult.exitCode).toBe(0);
    expect(rollbackResult.stderr).toBe("");
    expect(rollbackResult.stdout).toContain("Created rollback group");
    expect(rollbackResult.stdout).toContain('on branch "main"');
    expect(rollbackResult.stdout).toContain(commitTime);

    const listResult = cli.runCli("update", "list", "--branch", "main");
    expect(listResult.exitCode).toBe(0);
    expect(listResult.stderr).toBe("");
    expect(listResult.stdout).toContain("Update ID");
    expect(listResult.stdout).toContain("main");
    expect(listResult.stdout).toContain("ios");
    expect(listResult.stdout).toContain("1.0.0");
    expect(listResult.stdout).toContain("yes");
    const rollbackMatch = /^([^\s]+)\s+([^\s]+)\s+main\s+ios\s+1\.0\.0\s+100%\s+yes\s+.+$/m.exec(
      listResult.stdout,
    );
    expect(rollbackMatch).toBeDefined();
    cliState.rollbackUpdateId = rollbackMatch?.[1] ?? "";
    cliState.rollbackGroupId = rollbackMatch?.[2] ?? "";
  });

  it("creates a signed rollback update from the CLI using pre-signed files", async () => {
    const signedCommitTime = "2026-04-15T00:00:00.000Z";
    const directiveBodyPath = path.join(cli.getProjectDir(), "signed-directive.json");
    const signaturePath = path.join(cli.getProjectDir(), "signed-directive.sig");
    const certificateChainPath = path.join(cli.getProjectDir(), "signed-directive.pem");
    const signedMessage = "Signed rollback via CLI";

    writeFileSync(
      directiveBodyPath,
      JSON.stringify({
        type: "rollBackToEmbedded",
        parameters: { commitTime: signedCommitTime },
      }),
    );
    writeFileSync(signaturePath, 'sig="signed-cli-test", keyid="main", alg="rsa-v1_5_sha256"\n');
    writeFileSync(
      certificateChainPath,
      "-----BEGIN CERTIFICATE-----\nSIGNED CLI TEST\n-----END CERTIFICATE-----\n",
    );

    const rollbackResult = cli.runCli(
      "update",
      "rollback",
      "--branch",
      "main",
      "--platform",
      "ios",
      "--message",
      signedMessage,
      "--directive-body-file",
      directiveBodyPath,
      "--signature-file",
      signaturePath,
      "--certificate-chain-file",
      certificateChainPath,
    );

    expect(rollbackResult.exitCode).toBe(0);
    expect(rollbackResult.stderr).toBe("");
    expect(rollbackResult.stdout).toContain("Created rollback group");
    expect(rollbackResult.stdout).toContain(signedCommitTime);

    const updatesResponse = await cli.getAuthorized(`/api/updates?projectId=${cli.getProjectId()}`);
    expect(updatesResponse.status).toBe(200);
    const updatesBody = (await updatesResponse.json()) as {
      items: {
        message: string;
        signature: string | null;
        certificateChain: string | null;
        directiveBody: string | null;
      }[];
    };

    expect(updatesBody.items).toStrictEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: signedMessage,
          signature: 'sig="signed-cli-test", keyid="main", alg="rsa-v1_5_sha256"',
          certificateChain:
            "-----BEGIN CERTIFICATE-----\nSIGNED CLI TEST\n-----END CERTIFICATE-----",
          directiveBody: JSON.stringify({
            type: "rollBackToEmbedded",
            parameters: { commitTime: signedCommitTime },
          }),
        }),
      ]),
    );
  });

  it("uploads and deletes a distribution certificate", () => {
    // The org vault is bootstrapped in the suite's beforeAll; reuse that identity
    // (a `machine` recipient registered via BETTER_UPDATE_IDENTITY) to seal/unseal.
    const credentialFile = path.join(cli.getProjectDir(), "cli-uploaded-cert.p12");
    const p12Password = "uploaded-password";
    writeFileSync(
      credentialFile,
      generateSelfSignedP12(p12Password, "/OU=CLIE2ETEAM/CN=Apple Distribution: CLI E2E"),
    );

    const uploadResult = cli.runCliWithEnv(
      credsEnv,
      "credentials",
      "upload",
      "--platform",
      "ios",
      "--type",
      "distribution-certificate",
      "--name",
      "CLI Uploaded Certificate",
      "--file",
      credentialFile,
      "--password",
      p12Password,
    );
    expect(uploadResult.exitCode).toBe(0);
    expect(uploadResult.stderr).toBe("");
    expect(uploadResult.stdout).toContain("Credential uploaded successfully.");
    expect(uploadResult.stdout).toContain("CLI Uploaded Certificate");
    const uploadedCredentialId = /^ID\s+([^\s]+)$/m.exec(uploadResult.stdout)?.[1];
    expect(uploadedCredentialId).toBeDefined();

    const listAfterUpload = cli.runCli("credentials", "list", "--platform", "ios");
    expect(listAfterUpload.exitCode).toBe(0);
    expect(listAfterUpload.stderr).toBe("");
    expect(listAfterUpload.stdout).toContain(uploadedCredentialId!);
    expect(listAfterUpload.stdout).toContain("distribution-certificate");
    expect(listAfterUpload.stdout).toContain("ios");

    const downloadDir = path.join(cli.getProjectDir(), "downloaded-cert.p12");
    const downloadResult = cli.runCliWithEnv(
      credsEnv,
      "credentials",
      "download",
      uploadedCredentialId!,
      "--type",
      "distribution-certificate",
      "--output",
      downloadDir,
    );
    expect(downloadResult.exitCode).toBe(0);
    expect(downloadResult.stderr).toBe("");
    expect(downloadResult.stdout).toContain(downloadDir);
    expect(downloadResult.stdout).toContain(p12Password);
    expect(existsSync(downloadDir)).toBe(true);
    expect(statSync(downloadDir).size).toBeGreaterThan(0);

    const deleteResult = cli.runCli(
      "credentials",
      "delete",
      uploadedCredentialId!,
      "--platform",
      "ios",
      "--type",
      "distribution-certificate",
    );
    expect(deleteResult.exitCode).toBe(0);
    expect(deleteResult.stderr).toBe("");
    expect(deleteResult.stdout).toContain(`Credential ${uploadedCredentialId} deleted.`);

    const listAfterDelete = cli.runCli("credentials", "list", "--platform", "ios");
    expect(listAfterDelete.exitCode).toBe(0);
    expect(listAfterDelete.stderr).toBe("");
    expect(listAfterDelete.stdout).not.toContain(uploadedCredentialId!);
  });

  it("manages rollout state, promotes an update, and deletes the promoted group", async () => {
    expect(cliState.rollbackUpdateId).not.toBe("");
    expect(cliState.rollbackGroupId).not.toBe("");

    const setResult = cli.runCli(
      "update",
      "rollout",
      "set",
      cliState.rollbackUpdateId,
      "--percentage",
      "25",
    );
    expect(setResult.exitCode).toBe(0);
    expect(setResult.stderr).toBe("");
    expect(setResult.stdout).toContain(`Updated rollout for ${cliState.rollbackUpdateId} to 25%.`);

    const listAfterSet = cli.runCli("update", "list", "--branch", "main");
    expect(listAfterSet.exitCode).toBe(0);
    expect(listAfterSet.stderr).toBe("");
    expect(listAfterSet.stdout).toMatch(
      new RegExp(
        `^${escapeRegExp(cliState.rollbackUpdateId)}\\s+${escapeRegExp(cliState.rollbackGroupId)}\\s+main\\s+ios\\s+1\\.0\\.0\\s+25%\\s+yes\\s+.+$`,
        "m",
      ),
    );

    const completeResult = cli.runCli("update", "rollout", "complete", cliState.rollbackUpdateId);
    expect(completeResult.exitCode).toBe(0);
    expect(completeResult.stderr).toBe("");
    expect(completeResult.stdout).toContain(
      `Completed rollout for ${cliState.rollbackUpdateId}. Current rollout is 100%.`,
    );

    const listAfterComplete = cli.runCli("update", "list", "--branch", "main");
    expect(listAfterComplete.exitCode).toBe(0);
    expect(listAfterComplete.stderr).toBe("");
    expect(listAfterComplete.stdout).toMatch(
      new RegExp(
        `^${escapeRegExp(cliState.rollbackUpdateId)}\\s+${escapeRegExp(cliState.rollbackGroupId)}\\s+main\\s+ios\\s+1\\.0\\.0\\s+100%\\s+yes\\s+.+$`,
        "m",
      ),
    );

    const revertResult = cli.runCli("update", "rollout", "revert", cliState.rollbackUpdateId);
    expect(revertResult.exitCode).toBe(0);
    expect(revertResult.stderr).toBe("");
    expect(revertResult.stdout).toContain(
      `Reverted rollout for ${cliState.rollbackUpdateId}. Current rollout is 0%.`,
    );

    const listAfterRevert = cli.runCli("update", "list", "--branch", "main");
    expect(listAfterRevert.exitCode).toBe(0);
    expect(listAfterRevert.stderr).toBe("");
    expect(listAfterRevert.stdout).toMatch(
      new RegExp(
        `^${escapeRegExp(cliState.rollbackUpdateId)}\\s+${escapeRegExp(cliState.rollbackGroupId)}\\s+main\\s+ios\\s+1\\.0\\.0\\s+0%\\s+yes\\s+.+$`,
        "m",
      ),
    );

    const targetName = `preview-${Date.now()}`;
    seedDestinationChannel(targetName);

    const promotableUpdate = await createPromotableUpdate();

    const promoteResult = cli.runCli(
      "update",
      "promote",
      promotableUpdate.id,
      "--channel",
      targetName,
    );
    expect(promoteResult.exitCode).toBe(0);
    expect(promoteResult.stderr).toBe("");
    expect(promoteResult.stdout).toContain(
      `Promoted update ${promotableUpdate.id} to channel "${targetName}" as update `,
    );

    const promotedList = cli.runCli("update", "list", "--branch", targetName);
    expect(promotedList.exitCode).toBe(0);
    expect(promotedList.stderr).toBe("");
    const promotedMatch = new RegExp(
      `^([^\\s]+)\\s+([^\\s]+)\\s+${escapeRegExp(targetName)}\\s+ios\\s+1\\.0\\.0\\s+100%\\s+no\\s+.+$`,
      "m",
    ).exec(promotedList.stdout);
    expect(promotedMatch).toBeDefined();

    const promotedGroupId = promotedMatch?.[2] ?? "";
    expect(promotedGroupId).not.toBe("");

    const deleteResult = cli.runCli("update", "delete", promotedGroupId);
    expect(deleteResult.exitCode).toBe(0);
    expect(deleteResult.stderr).toBe("");
    expect(deleteResult.stdout).toContain(`Deleted 1 update(s) from group ${promotedGroupId}.`);

    const finalPromotedList = cli.runCli("update", "list", "--branch", targetName);
    expect(finalPromotedList.exitCode).toBe(0);
    expect(finalPromotedList.stderr).toBe("");
    expect(finalPromotedList.stdout).toContain("No updates found.");
  });

  it("promotes a signed update from the CLI using replacement signed files", async () => {
    const targetName = `signed-preview-${Date.now()}`;
    seedDestinationChannel(targetName);

    const promotableUpdate = await createPromotableUpdate({
      signed: {
        manifestId: "cli-signed-source-manifest",
        createdAt: "2026-04-14T10:00:00.000Z",
        signature: 'sig="source-signature", keyid="main", alg="rsa-v1_5_sha256"',
        certificateChain: "-----BEGIN CERTIFICATE-----\nSOURCE\n-----END CERTIFICATE-----",
      },
    });

    const manifestBodyPath = path.join(
      cli.getProjectDir(),
      `signed-promote-manifest-${Date.now()}.json`,
    );
    const signaturePath = path.join(cli.getProjectDir(), `signed-promote-${Date.now()}.sig`);
    const certificateChainPath = path.join(cli.getProjectDir(), `signed-promote-${Date.now()}.pem`);
    const replacementManifestBody = JSON.stringify({
      id: "cli-signed-promoted-manifest",
      createdAt: "2026-04-15T10:00:00.000Z",
      runtimeVersion: "1.0.0",
      launchAsset: {
        key: promotableUpdate.launchAssetKey,
        hash: promotableUpdate.assetHash,
      },
      assets: [],
    });

    writeFileSync(manifestBodyPath, replacementManifestBody);
    writeFileSync(
      signaturePath,
      'sig="replacement-signature", keyid="main", alg="rsa-v1_5_sha256"\n',
    );
    writeFileSync(
      certificateChainPath,
      "-----BEGIN CERTIFICATE-----\nREPLACEMENT\n-----END CERTIFICATE-----\n",
    );

    const promoteResult = cli.runCli(
      "update",
      "promote",
      promotableUpdate.id,
      "--channel",
      targetName,
      "--manifest-body-file",
      manifestBodyPath,
      "--signature-file",
      signaturePath,
      "--certificate-chain-file",
      certificateChainPath,
    );
    expect(promoteResult.exitCode).toBe(0);
    expect(promoteResult.stderr).toBe("");

    const promotedUpdateId = /as update ([^\s.]+)\./.exec(promoteResult.stdout)?.[1];
    expect(promotedUpdateId).toBeDefined();

    const updatesResponse = await cli.getAuthorized(`/api/updates?projectId=${cli.getProjectId()}`);
    expect(updatesResponse.status).toBe(200);
    const updatesBody = (await updatesResponse.json()) as {
      items: {
        id: string;
        branchId: string;
        signature: string | null;
        certificateChain: string | null;
        manifestBody: string | null;
      }[];
    };

    expect(updatesBody.items).toStrictEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: promotedUpdateId,
          signature: 'sig="replacement-signature", keyid="main", alg="rsa-v1_5_sha256"',
          certificateChain: "-----BEGIN CERTIFICATE-----\nREPLACEMENT\n-----END CERTIFICATE-----",
          manifestBody: replacementManifestBody,
        }),
      ]),
    );
  });
});
