import { createHash } from "node:crypto";

import { Effect } from "effect";

import { setupE2EWorker } from "../helpers/e2e-worker-pool";

const { del, get, parseCookies, patch, post, postNoBody, putAbsolute } = setupE2EWorker(
  ".wrangler/state/e2e-updates",
);

// ── Helpers ───────────────────────────────────────────────────────

const manifestGet = (projectId: string, headers: Record<string, string>) =>
  get(`/manifest/${projectId}`, headers);

const protocolHeaders = (
  channelName: string,
  runtimeVersion: string,
  platform: "ios" | "android",
  overrides?: Record<string, string>,
) => ({
  "expo-protocol-version": "1",
  "expo-platform": platform,
  "expo-runtime-version": runtimeVersion,
  "expo-channel-name": channelName,
  accept: "multipart/mixed",
  ...overrides,
});

interface MultipartPart {
  readonly headers: Record<string, string>;
  readonly body: string;
}

const parseMultipart = (contentType: string, rawBody: string): readonly MultipartPart[] => {
  const boundaryMatch = /boundary=([^\s;]+)/.exec(contentType);
  const boundary = boundaryMatch?.[1] ?? "";
  return rawBody
    .split(`--${boundary}`)
    .slice(1, -1)
    .map((part) => {
      const [headerSection = "", ...bodySections] = part.split("\r\n\r\n");
      const headers = Object.fromEntries(
        headerSection
          .split("\r\n")
          .filter(Boolean)
          .map((line) => {
            const idx = line.indexOf(": ");
            return [line.slice(0, idx).toLowerCase(), line.slice(idx + 2)];
          }),
      );
      return { headers, body: bodySections.join("\r\n\r\n").replace(/\r\n$/, "") };
    });
};

// ── Updates & Assets API E2E ─────────────────────────────────────

describe("Updates & Assets API flow", () => {
  let cookies: string;
  let organizationId: string;
  let projectId: string;
  let autoProjectId: string;
  let mainBranchId: string;
  let stagingBranchId: string;
  let rollbackBranchId: string;
  let productionChannelId: string;
  let updateId: string;
  let stagingUpdateId: string;
  let rollbackUpdateId: string;
  let signedUpdateId: string;
  let apiKeyValue: string;
  let firstAssetUpload: { uploadUrl: string; uploadHeaders: Record<string, string> };
  let secondAssetUpload: { uploadUrl: string; uploadHeaders: Record<string, string> };
  let apiKeyAssetUpload: { uploadUrl: string; uploadHeaders: Record<string, string> };

  const firstAssetContent = "console.log('hello')";
  const secondAssetContent = "console.log('world')";
  const apiKeyAssetContent = "hello";
  const firstAssetHash = createHash("sha256").update(firstAssetContent).digest("base64url");
  const secondAssetHash = createHash("sha256").update(secondAssetContent).digest("base64url");
  const apiKeyAssetHash = createHash("sha256").update(apiKeyAssetContent).digest("base64url");

  // ── Section 1: Auth bootstrap ──────────────────────────────────

  it("registers a new user", async () => {
    const response = await post("/api/auth/sign-up/email", {
      name: "Updates E2E User",
      email: "updates-e2e@example.com",
      password: "SecureP@ss123",
    });
    expect(response.status).toBe(200);
    cookies = parseCookies(response);
    expect(cookies).toBeTruthy();
  });

  it("creates an organization", async () => {
    const response = await post(
      "/api/auth/organization/create",
      { name: "Updates Org", slug: "updates-org" },
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBeDefined();
    organizationId = body.id;
    cookies = parseCookies(response) || cookies;
  });

  it("sets the organization as active", async () => {
    const response = await post(
      "/api/auth/organization/set-active",
      { organizationId },
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
    cookies = parseCookies(response) || cookies;
  });

  // ── Section 2: Prerequisites ───────────────────────────────────

  it("creates a project", async () => {
    const response = await post(
      "/api/projects",
      { name: "Updates Test Project", slug: "updates-test" },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBeDefined();
    projectId = body.id;
  });

  it("creates a project for auto branch/channel creation", async () => {
    const response = await post(
      "/api/projects",
      { name: "Updates Auto Project", slug: "updates-auto" },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBeDefined();
    autoProjectId = body.id;
  });

  it("creates main branch", async () => {
    const response = await post("/api/branches", { projectId, name: "main" }, { cookie: cookies });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBeDefined();
    mainBranchId = body.id;
  });

  // The project is seeded with production/staging/preview branches+channels.
  // Reuse the seeded "staging" branch + "production" channel; rebind the
  // production channel to the new "main" branch for downstream tests.

  it("resolves seeded staging branch + production channel", async () => {
    const branchesRes = await get(`/api/branches?projectId=${projectId}`, { cookie: cookies });
    expect(branchesRes.status).toBe(200);
    const branchesBody = await branchesRes.json();
    const staging = branchesBody.items.find((b: { name: string }) => b.name === "staging");
    expect(staging).toBeDefined();
    stagingBranchId = staging.id;

    const channelsRes = await get(`/api/channels?projectId=${projectId}`, { cookie: cookies });
    expect(channelsRes.status).toBe(200);
    const channelsBody = await channelsRes.json();
    const production = channelsBody.items.find((c: { name: string }) => c.name === "production");
    expect(production).toBeDefined();
    productionChannelId = production.id;
  });

  it("rebinds production channel to main branch", async () => {
    const response = await patch(
      `/api/channels/${productionChannelId}`,
      { branchId: mainBranchId },
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
    expect((await response.json()).branchId).toBe(mainBranchId);
  });

  it("creates rollback branch", async () => {
    const response = await post(
      "/api/branches",
      { projectId, name: "rollback" },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBeDefined();
    rollbackBranchId = body.id;
  });

  it("creates rollback channel linked to rollback branch", async () => {
    const response = await post(
      "/api/channels",
      { projectId, name: "rollback", branchId: rollbackBranchId },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
  });

  // ── Section 3: Asset upload flow ───────────────────────────────

  it("registers asset metadata", async () => {
    const response = await post(
      "/api/assets/upload",
      {
        projectId,
        assets: [
          { hash: firstAssetHash, contentType: "application/javascript", fileExt: "js" },
          { hash: secondAssetHash, contentType: "application/javascript", fileExt: "js" },
        ],
      },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.uploaded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          hash: firstAssetHash,
          uploadMode: "single",
          uploadUrl: expect.any(String),
          uploadHeaders: expect.any(Object),
        }),
        expect.objectContaining({
          hash: secondAssetHash,
          uploadMode: "single",
          uploadUrl: expect.any(String),
          uploadHeaders: expect.any(Object),
        }),
      ]),
    );
    expect(body.deduplicated).toHaveLength(0);
    firstAssetUpload =
      body.uploaded.find((asset: { hash: string }) => asset.hash === firstAssetHash) ?? {};
    secondAssetUpload =
      body.uploaded.find((asset: { hash: string }) => asset.hash === secondAssetHash) ?? {};
  });

  it("rejects update creation while an asset is only registered but not uploaded", async () => {
    const pendingAssetContent = "console.log('pending')";
    const pendingAssetHash = createHash("sha256").update(pendingAssetContent).digest("base64url");

    const registerResponse = await post(
      "/api/assets/upload",
      {
        projectId,
        assets: [{ hash: pendingAssetHash, contentType: "application/javascript", fileExt: "js" }],
      },
      { cookie: cookies },
    );
    expect(registerResponse.status).toBe(201);

    const publishResponse = await post(
      "/api/updates",
      {
        slug: "updates-test",
        branch: "main",
        runtimeVersion: "1.0.0",
        platform: "ios",
        message: "Pending asset publish",
        groupId: "group-pending-asset",
        metadata: {},
        assets: [{ hash: pendingAssetHash, key: "bundles/pending.js", isLaunch: true }],
      },
      { cookie: cookies },
    );
    expect(publishResponse.status).toBe(409);
    expect(await publishResponse.json()).toEqual(
      expect.objectContaining({
        message: expect.stringContaining("Assets not uploaded"),
      }),
    );
  });

  it("uploads first asset binary", async () => {
    const bytes = new TextEncoder().encode(firstAssetContent);
    const response = await putAbsolute(firstAssetUpload.uploadUrl, bytes, {
      "content-length": bytes.byteLength.toString(),
      ...firstAssetUpload.uploadHeaders,
    });
    expect(response.status).toBe(200);
  });

  it("finalizes first asset binary", async () => {
    const response = await postNoBody(`/api/assets/${firstAssetHash}/finalize`, {
      cookie: cookies,
    });
    expect(response.status).toBe(200);
  });

  it("uploads second asset binary", async () => {
    const bytes = new TextEncoder().encode(secondAssetContent);
    const response = await putAbsolute(secondAssetUpload.uploadUrl, bytes, {
      "content-length": bytes.byteLength.toString(),
      ...secondAssetUpload.uploadHeaders,
    });
    expect(response.status).toBe(200);
  });

  it("finalizes second asset binary", async () => {
    const response = await postNoBody(`/api/assets/${secondAssetHash}/finalize`, {
      cookie: cookies,
    });
    expect(response.status).toBe(200);
  });

  it("deduplicates already-uploaded assets", async () => {
    const response = await post(
      "/api/assets/upload",
      {
        projectId,
        assets: [
          { hash: firstAssetHash, contentType: "application/javascript", fileExt: "js" },
          { hash: secondAssetHash, contentType: "application/javascript", fileExt: "js" },
        ],
      },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.uploaded).toHaveLength(0);
    expect(body.deduplicated).toContain(firstAssetHash);
    expect(body.deduplicated).toContain(secondAssetHash);
  });

  it("auto-creates branch and channel on first publish", async () => {
    const publishResponse = await post(
      "/api/updates",
      {
        slug: "updates-auto",
        branch: "preview-auto",
        runtimeVersion: "1.0.0",
        platform: "ios",
        message: "Auto branch publish",
        groupId: "group-auto-1",
        metadata: {},
        assets: [{ hash: firstAssetHash, key: "bundles/ios.js", isLaunch: true }],
      },
      { cookie: cookies },
    );
    expect(publishResponse.status).toBe(201);
    const publishBody = await publishResponse.json();
    expect(publishBody.branchId).toBeDefined();

    const branchesResponse = await get(`/api/branches?projectId=${autoProjectId}`, {
      cookie: cookies,
    });
    expect(branchesResponse.status).toBe(200);
    const branchesBody = await branchesResponse.json();
    const previewBranch = branchesBody.items.find(
      (branch: { id: string; name: string }) => branch.name === "preview-auto",
    );
    expect(previewBranch).toBeDefined();
    if (!previewBranch) {
      throw new Error("Expected auto-created branch to exist");
    }

    const channelsResponse = await get(`/api/channels?projectId=${autoProjectId}`, {
      cookie: cookies,
    });
    expect(channelsResponse.status).toBe(200);
    const channelsBody = await channelsResponse.json();
    const previewChannel = channelsBody.items.find(
      (channel: { name: string; branchId: string }) => channel.name === "preview-auto",
    );
    expect(previewChannel).toBeDefined();
    if (!previewChannel) {
      throw new Error("Expected auto-created channel to exist");
    }
    expect(previewChannel.branchId).toBe(previewBranch.id);
    expect(previewChannel.branchId).toBe(publishBody.branchId);
  });

  it("rejects auto branch creation when the channel name is already linked elsewhere", async () => {
    const conflictingBranchResponse = await post(
      "/api/branches",
      { projectId: autoProjectId, name: "conflict-source" },
      { cookie: cookies },
    );
    expect(conflictingBranchResponse.status).toBe(201);
    const conflictingBranchId = (await conflictingBranchResponse.json()).id as string;

    const conflictingChannelResponse = await post(
      "/api/channels",
      {
        projectId: autoProjectId,
        name: "conflict-preview",
        branchId: conflictingBranchId,
      },
      { cookie: cookies },
    );
    expect(conflictingChannelResponse.status).toBe(201);

    const publishResponse = await post(
      "/api/updates",
      {
        slug: "updates-auto",
        branch: "conflict-preview",
        runtimeVersion: "1.0.0",
        platform: "ios",
        message: "Should not auto-create",
        groupId: "group-auto-conflict",
        metadata: {},
        assets: [{ hash: firstAssetHash, key: "bundles/ios.js", isLaunch: true }],
      },
      { cookie: cookies },
    );
    expect(publishResponse.status).toBe(409);

    const branchesResponse = await get(`/api/branches?projectId=${autoProjectId}`, {
      cookie: cookies,
    });
    expect(branchesResponse.status).toBe(200);
    const branchesBody = await branchesResponse.json();
    expect(
      branchesBody.items.some((branch: { name: string }) => branch.name === "conflict-preview"),
    ).toBe(false);
  });

  // ── Section 4: Update CRUD ─────────────────────────────────────

  it("creates an iOS update", async () => {
    const response = await post(
      "/api/updates",
      {
        slug: "updates-test",
        branch: "main",
        runtimeVersion: "1.0.0",
        platform: "ios",
        message: "Initial release",
        groupId: "group-1",
        metadata: { buildNumber: "42" },
        assets: [
          { hash: firstAssetHash, key: "bundles/ios.js", isLaunch: true },
          { hash: secondAssetHash, key: "assets/logo.js", isLaunch: false },
        ],
      },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toHaveProperty("id");
    expect(body).toHaveProperty("branchId");
    expect(body).toHaveProperty("runtimeVersion");
    expect(body).toHaveProperty("platform");
    expect(body).toHaveProperty("message");
    expect(body).toHaveProperty("groupId");
    expect(body).toHaveProperty("rolloutPercentage");
    expect(body).toHaveProperty("isRollback");
    expect(body).toHaveProperty("createdAt");
    expect(body.runtimeVersion).toBe("1.0.0");
    expect(body.platform).toBe("ios");
    expect(body.message).toBe("Initial release");
    expect(body.groupId).toBe("group-1");
    expect(body.rolloutPercentage).toBe(100);
    expect(body.isRollback).toBe(false);
    updateId = body.id;
  });

  it("creates an Android update in same group", async () => {
    const response = await post(
      "/api/updates",
      {
        slug: "updates-test",
        branch: "main",
        runtimeVersion: "1.0.0",
        platform: "android",
        message: "Initial release",
        groupId: "group-1",
        metadata: { buildNumber: "42" },
        assets: [{ hash: firstAssetHash, key: "bundles/android.js", isLaunch: true }],
      },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
  });

  it("lists updates for project", async () => {
    const response = await get(`/api/updates?projectId=${projectId}`, {
      cookie: cookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("items");
    expect(body).toHaveProperty("total");
    expect(body).toHaveProperty("page");
    expect(body).toHaveProperty("limit");
    expect(body.total).toBe(2);
    expect(body.items).toHaveLength(2);
  });

  it("lists updates filtered by branchId", async () => {
    const response = await get(`/api/updates?projectId=${projectId}&branchId=${mainBranchId}`, {
      cookie: cookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toHaveLength(2);
  });

  it("lists updates filtered by platform", async () => {
    const response = await get(`/api/updates?projectId=${projectId}&platform=ios`, {
      cookie: cookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items.every((item: { platform: string }) => item.platform === "ios")).toBe(true);
  });

  it("returns asset list for an update", async () => {
    const response = await get(`/api/updates/${updateId}/assets`, {
      cookie: cookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
    const hashes = body.map((asset: { hash: string }) => asset.hash).sort();
    expect(hashes).toStrictEqual([firstAssetHash, secondAssetHash].sort());
    const launchAssets = body.filter((asset: { isLaunch: boolean }) => asset.isLaunch);
    expect(launchAssets).toHaveLength(1);
    expect(launchAssets[0].hash).toBe(firstAssetHash);
  });

  it("creates a rollback-to-embedded directive update", async () => {
    const directiveBody = JSON.stringify({
      type: "rollBackToEmbedded",
      parameters: {
        commitTime: "2026-04-14T00:00:00.000Z",
      },
    });

    const response = await post(
      "/api/updates",
      {
        slug: "updates-test",
        branch: "rollback",
        runtimeVersion: "9.0.0",
        platform: "ios",
        message: "Rollback to embedded",
        groupId: "group-rollback-1",
        metadata: {},
        assets: [],
        isRollback: true,
        directiveBody,
      },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.isRollback).toBe(true);
    expect(body.directiveBody).toBe(directiveBody);
    rollbackUpdateId = body.id as string;
  });

  it("serves the rollback directive from the manifest endpoint", async () => {
    const response = await manifestGet(projectId, protocolHeaders("rollback", "9.0.0", "ios"));
    expect(response.status).toBe(200);

    const contentType = response.headers.get("content-type");
    expect(contentType).toContain("multipart/mixed");

    const body = await response.text();
    const parts = parseMultipart(contentType ?? "", body);
    const directivePart = parts.find((part) =>
      part.headers["content-disposition"]?.includes('name="directive"'),
    );

    expect(directivePart).toBeDefined();
    expect(JSON.parse(directivePart?.body ?? "")).toEqual({
      type: "rollBackToEmbedded",
      parameters: {
        commitTime: "2026-04-14T00:00:00.000Z",
      },
    });
  });

  // ── Section 5: Rollout operations ──────────────────────────────

  it("edits rollout to 50%", async () => {
    const response = await patch(
      `/api/updates/${updateId}/rollout`,
      { percentage: 50 },
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.rolloutPercentage).toBe(50);
  });

  it("completes rollout", async () => {
    const response = await post(
      `/api/updates/${updateId}/rollout/complete`,
      {},
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.rolloutPercentage).toBe(100);
  });

  it("reverts rollout", async () => {
    const response = await post(`/api/updates/${updateId}/rollout/revert`, {}, { cookie: cookies });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.rolloutPercentage).toBe(0);
  });

  // ── Section 6: Republish ───────────────────────────────────────

  it("creates an update on staging branch", async () => {
    const response = await post(
      "/api/updates",
      {
        slug: "updates-test",
        branch: "staging",
        runtimeVersion: "1.0.0",
        platform: "ios",
        message: "Staging build",
        groupId: "group-staging",
        metadata: {},
        assets: [{ hash: firstAssetHash, key: "bundles/ios.js", isLaunch: true }],
      },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    stagingUpdateId = body.id;
  });

  it("republishes to production channel", async () => {
    const response = await post(
      "/api/updates/republish",
      {
        sourceUpdateId: stagingUpdateId,
        destinationChannel: "production",
      },
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.updates).toHaveLength(1);
    expect(body.updates[0]).toHaveProperty("id");
    expect(body.updates[0]?.branchId).toBe(mainBranchId);
  });

  it("republishes an update group to a destination branch", async () => {
    const response = await post(
      "/api/updates/republish",
      {
        sourceGroupId: "group-1",
        destinationBranchId: stagingBranchId,
        message: "Promoted release train",
      },
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.updates).toHaveLength(2);
    const groupIds = new Set(body.updates.map((update: { groupId: string }) => update.groupId));
    expect(groupIds.size).toBe(1);
    expect(groupIds.has("group-1")).toBe(false);
    expect(
      body.updates.every(
        (update: { branchId: string; message: string }) =>
          update.branchId === stagingBranchId && update.message === "Promoted release train",
      ),
    ).toBe(true);
  });

  it("creates a signed source update", async () => {
    const manifestBody = JSON.stringify({
      id: "signed-source-manifest",
      createdAt: "2026-04-14T10:00:00.000Z",
      runtimeVersion: "1.0.0",
      launchAsset: { key: "bundles/ios.js", hash: firstAssetHash },
      assets: [],
    });

    const response = await post(
      "/api/updates",
      {
        slug: "updates-test",
        branch: "signed-source",
        runtimeVersion: "1.0.0",
        platform: "ios",
        message: "Signed source",
        groupId: "group-signed-source",
        metadata: {},
        assets: [{ hash: firstAssetHash, key: "bundles/ios.js", isLaunch: true }],
        manifestBody,
        signature: 'sig="test-signature", keyid="main", alg="rsa-v1_5-sha256"',
        certificateChain: "-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----",
      },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    signedUpdateId = (await response.json()).id as string;
  });

  it("rejects republishing a signed source update without replacement signed manifests", async () => {
    const response = await post(
      "/api/updates/republish",
      {
        sourceUpdateId: signedUpdateId,
        destinationChannel: "production",
      },
      { cookie: cookies },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        message: expect.stringContaining("replacement signed manifests"),
      }),
    );
  });

  it("republishes a signed source update when replacement signed manifests are supplied", async () => {
    const replacementManifestBody = JSON.stringify({
      id: "signed-production-manifest",
      createdAt: "2026-04-15T10:00:00.000Z",
      runtimeVersion: "1.0.0",
      launchAsset: { key: "bundles/ios.js", hash: firstAssetHash },
      assets: [],
    });

    const response = await post(
      "/api/updates/republish",
      {
        sourceUpdateId: signedUpdateId,
        destinationChannel: "production",
        signedUpdates: [
          {
            sourceUpdateId: signedUpdateId,
            manifestBody: replacementManifestBody,
            signature: 'sig="replacement-signature", keyid="main", alg="rsa-v1_5_sha256"',
            certificateChain: "-----BEGIN CERTIFICATE-----\nREPLACEMENT\n-----END CERTIFICATE-----",
          },
        ],
      },
      { cookie: cookies },
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      updates: Array<{
        id: string;
        branchId: string;
        signature: string | null;
        certificateChain: string | null;
        manifestBody: string | null;
      }>;
    };
    expect(body.updates).toHaveLength(1);
    expect(body.updates[0]?.branchId).toBe(mainBranchId);
    expect(body.updates[0]?.signature).toBe(
      'sig="replacement-signature", keyid="main", alg="rsa-v1_5_sha256"',
    );
    expect(body.updates[0]?.certificateChain).toBe(
      "-----BEGIN CERTIFICATE-----\nREPLACEMENT\n-----END CERTIFICATE-----",
    );
    expect(body.updates[0]?.manifestBody).toBe(replacementManifestBody);

    const manifestResponse = await manifestGet(
      projectId,
      protocolHeaders("production", "1.0.0", "ios", {
        "expo-expect-signature": 'sig, keyid="main", alg="rsa-v1_5_sha256"',
      }),
    );
    expect(manifestResponse.status).toBe(200);

    const parts = parseMultipart(
      manifestResponse.headers.get("content-type") ?? "",
      await manifestResponse.text(),
    );
    const manifestPart = parts.find((part) =>
      part.headers["content-disposition"]?.includes('name="manifest"'),
    );
    const certificatePart = parts.find((part) =>
      part.headers["content-disposition"]?.includes('name="certificate_chain"'),
    );
    expect(manifestPart?.headers["expo-signature"]).toBe(
      'sig="replacement-signature", keyid="main", alg="rsa-v1_5_sha256"',
    );
    expect(manifestPart?.body).toBe(replacementManifestBody);
    expect(certificatePart?.body).toBe(
      "-----BEGIN CERTIFICATE-----\nREPLACEMENT\n-----END CERTIFICATE-----",
    );
  });

  it("rejects republishing a rollback directive", async () => {
    const response = await post(
      "/api/updates/republish",
      {
        sourceUpdateId: rollbackUpdateId,
        destinationChannel: "production",
      },
      { cookie: cookies },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        message: "Cannot republish a rollback directive",
      }),
    );
  });

  // ── Section 7: Delete group ────────────────────────────────────

  it("deletes update group-1", async () => {
    const response = await del(`/api/updates/group-1`, {
      cookie: cookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.deleted).toBe(2);
  });

  it("lists updates - group-1 gone", async () => {
    const response = await get(`/api/updates?projectId=${projectId}`, {
      cookie: cookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    // group-1 had 2 updates (ios + android); only the original group is deleted
    expect(body.items.every((u: { groupId: string }) => u.groupId !== "group-1")).toBe(true);
  });

  // ── Section 8: API key auth ────────────────────────────────────

  it("creates an API key", async () => {
    const response = await post(
      "/api/auth/api-key/create",
      { name: "updates-test-key", organizationId },
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.key).toMatch(/^bu_/);
    apiKeyValue = body.key;
  });

  it("lists updates via API key", async () => {
    const response = await get(`/api/updates?projectId=${projectId}`, {
      authorization: `Bearer ${apiKeyValue}`,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("items");
    expect(body).toHaveProperty("total");
    expect(body).toHaveProperty("page");
    expect(body).toHaveProperty("limit");
  });

  it("registers asset metadata via API key", async () => {
    const response = await post(
      "/api/assets/upload",
      {
        projectId,
        assets: [{ hash: apiKeyAssetHash, contentType: "text/plain", fileExt: "txt" }],
      },
      { authorization: `Bearer ${apiKeyValue}` },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.uploaded).toEqual([
      expect.objectContaining({
        hash: apiKeyAssetHash,
        uploadMode: "single",
        uploadUrl: expect.any(String),
        uploadHeaders: expect.any(Object),
      }),
    ]);
    apiKeyAssetUpload = body.uploaded[0] as {
      uploadUrl: string;
      uploadHeaders: Record<string, string>;
    };
  });

  it("uploads asset binary via API key", async () => {
    const bytes = new TextEncoder().encode(apiKeyAssetContent);
    const response = await putAbsolute(apiKeyAssetUpload.uploadUrl, bytes, {
      "content-length": bytes.byteLength.toString(),
      ...apiKeyAssetUpload.uploadHeaders,
    });
    expect(response.status).toBe(200);
  });

  it("finalizes API key asset upload", async () => {
    const response = await postNoBody(`/api/assets/${apiKeyAssetHash}/finalize`, {
      authorization: `Bearer ${apiKeyValue}`,
    });
    expect(response.status).toBe(200);
  });

  // ── Section 9: Cross-org isolation ─────────────────────────────

  let projectIdB: string;

  it("creates org B and switches to it", async () => {
    const orgRes = await post(
      "/api/auth/organization/create",
      { name: "Org B", slug: "updates-org-b" },
      { cookie: cookies },
    );
    expect(orgRes.status).toBe(200);
    const orgBId = (await orgRes.json()).id;
    cookies = parseCookies(orgRes) || cookies;

    const activeRes = await post(
      "/api/auth/organization/set-active",
      { organizationId: orgBId },
      { cookie: cookies },
    );
    expect(activeRes.status).toBe(200);
    cookies = parseCookies(activeRes) || cookies;
  });

  it("creates a project and branch in org B", async () => {
    const projRes = await post(
      "/api/projects",
      { name: "Org B Project", slug: "orgb-updates" },
      { cookie: cookies },
    );
    expect(projRes.status).toBe(201);
    projectIdB = (await projRes.json()).id;

    const branchRes = await post(
      "/api/branches",
      { projectId: projectIdB, name: "b-main" },
      { cookie: cookies },
    );
    expect(branchRes.status).toBe(201);
  });

  it("org B cannot list updates for org A project (404)", async () => {
    const response = await get(`/api/updates?projectId=${projectId}`, {
      cookie: cookies,
    });
    expect(response.status).toBe(404);
  });

  it("switches back to org A - updates untouched", async () => {
    const activeRes = await post(
      "/api/auth/organization/set-active",
      { organizationId },
      { cookie: cookies },
    );
    expect(activeRes.status).toBe(200);
    cookies = parseCookies(activeRes) || cookies;

    const response = await get(`/api/updates?projectId=${projectId}`, {
      cookie: cookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("items");
    expect(body.items.every((u: { groupId: string }) => u.groupId !== "group-1")).toBe(true);
  });

  // ── Section 10: Same-runtime publish blocking ─────────────────

  let blockingBranchId: string;
  let blockingUpdateId: string;

  it("creates branch for publish-blocking test", async () => {
    const response = await post(
      "/api/branches",
      { projectId, name: "blocking-test" },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    blockingBranchId = body.id;
  });

  it("creates channel for publish-blocking test", async () => {
    const response = await post(
      "/api/channels",
      { projectId, name: "blocking-channel", branchId: blockingBranchId },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
  });

  it("creates update with partial rollout (50%)", async () => {
    const response = await post(
      "/api/updates",
      {
        slug: "updates-test",
        branch: "blocking-test",
        runtimeVersion: "2.0.0",
        platform: "ios",
        message: "Canary release",
        groupId: "group-blocking-1",
        metadata: {},
        rolloutPercentage: 50,
        assets: [{ hash: firstAssetHash, key: "bundles/ios.js", isLaunch: true }],
      },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.rolloutPercentage).toBe(50);
    blockingUpdateId = body.id;
  });

  it("rejects publish to same branch/platform/runtimeVersion during active rollout (409)", async () => {
    const response = await post(
      "/api/updates",
      {
        slug: "updates-test",
        branch: "blocking-test",
        runtimeVersion: "2.0.0",
        platform: "ios",
        message: "Should be blocked",
        groupId: "group-blocking-2",
        metadata: {},
        assets: [{ hash: firstAssetHash, key: "bundles/ios.js", isLaunch: true }],
      },
      { cookie: cookies },
    );
    expect(response.status).toBe(409);
  });

  it("completes the active rollout", async () => {
    const response = await post(
      `/api/updates/${blockingUpdateId}/rollout/complete`,
      {},
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.rolloutPercentage).toBe(100);
  });

  it("allows publish after rollout is completed", async () => {
    const response = await post(
      "/api/updates",
      {
        slug: "updates-test",
        branch: "blocking-test",
        runtimeVersion: "2.0.0",
        platform: "ios",
        message: "After rollout complete",
        groupId: "group-blocking-3",
        metadata: {},
        assets: [{ hash: firstAssetHash, key: "bundles/ios.js", isLaunch: true }],
      },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
  });

  it("serializes concurrent rollout publishes on the same branch", async () => {
    const branchResponse = await post(
      "/api/branches",
      { projectId, name: "concurrent-rollout" },
      { cookie: cookies },
    );
    expect(branchResponse.status).toBe(201);
    const concurrentBranchId = (await branchResponse.json()).id as string;

    const [first, second] = await Effect.runPromise(
      Effect.all(
        [
          Effect.promise(() =>
            post(
              "/api/updates",
              {
                slug: "updates-test",
                branch: "concurrent-rollout",
                runtimeVersion: "3.0.0",
                platform: "ios",
                message: "Concurrent rollout A",
                groupId: "group-concurrent-a",
                metadata: {},
                rolloutPercentage: 50,
                assets: [{ hash: firstAssetHash, key: "bundles/ios.js", isLaunch: true }],
              },
              { cookie: cookies },
            ),
          ),
          Effect.promise(() =>
            post(
              "/api/updates",
              {
                slug: "updates-test",
                branch: "concurrent-rollout",
                runtimeVersion: "3.0.0",
                platform: "ios",
                message: "Concurrent rollout B",
                groupId: "group-concurrent-b",
                metadata: {},
                rolloutPercentage: 50,
                assets: [{ hash: firstAssetHash, key: "bundles/ios.js", isLaunch: true }],
              },
              { cookie: cookies },
            ),
          ),
        ],
        { concurrency: "unbounded" },
      ),
    );

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);

    const updatesResponse = await get(
      `/api/updates?projectId=${projectId}&branchId=${concurrentBranchId}`,
      { cookie: cookies },
    );
    expect(updatesResponse.status).toBe(200);
    const updatesBody = await updatesResponse.json();
    const matching = updatesBody.items.filter(
      (update: { branchId: string; runtimeVersion: string; platform: string }) =>
        update.runtimeVersion === "3.0.0" && update.platform === "ios",
    );
    expect(matching).toHaveLength(1);
  });
});
