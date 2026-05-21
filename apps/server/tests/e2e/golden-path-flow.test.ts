import { createHash } from "node:crypto";

import { setupE2EWorker } from "../helpers/e2e-worker-pool";

const { del, get, parseCookies, post, postNoBody, putAbsolute } = setupE2EWorker(
  ".wrangler/state/e2e-golden-path",
);

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

interface UploadSlot {
  readonly uploadUrl: string;
  readonly uploadHeaders: Record<string, string>;
}

const uploadAndFinalizeAsset = async (params: {
  readonly projectId: string;
  readonly cookies: string;
  readonly content: string;
}): Promise<{ hash: string }> => {
  const hash = createHash("sha256").update(params.content).digest("base64url");

  const registerResponse = await post(
    "/api/assets/upload",
    {
      projectId: params.projectId,
      assets: [{ hash, contentType: "application/javascript", fileExt: "js" }],
    },
    { cookie: params.cookies },
  );
  expect(registerResponse.status).toBe(201);
  const registerBody = await registerResponse.json();
  const slot = registerBody.uploaded.find((asset: { hash: string }) => asset.hash === hash) as
    | UploadSlot
    | undefined;
  if (!slot) {
    throw new Error(`Upload slot for hash ${hash} not returned`);
  }

  const bytes = new TextEncoder().encode(params.content);
  const uploadResponse = await putAbsolute(slot.uploadUrl, bytes, {
    "content-length": bytes.byteLength.toString(),
    ...slot.uploadHeaders,
  });
  expect(uploadResponse.status).toBe(200);

  const finalizeResponse = await postNoBody(`/api/assets/${hash}/finalize`, {
    cookie: params.cookies,
  });
  expect(finalizeResponse.status).toBe(200);

  return { hash };
};

// ── Golden path: complete OTA lifecycle ─────────────────────────

describe("Golden path cross-flow", () => {
  let cookies: string;
  let organizationId: string;
  let projectId: string;
  let productionBranchId: string;
  let stagingBranchId: string;
  let rollbackBranchId: string;

  let v1AssetHash: string;
  let v2AssetHash: string;
  let v3AssetHash: string;

  let stagingV1UpdateId: string;
  let promotedV1UpdateId: string;
  let productionV2UpdateId: string;

  const projectSlug = "golden-path";
  const stagingV1GroupId = "golden-group-staging-v1";
  const productionV2GroupId = "golden-group-prod-v2";
  const productionV3GroupId = "golden-group-prod-v3";
  const rollbackGroupId = "golden-group-rollback";

  // ── Section 1: Auth bootstrap ──────────────────────────────────

  it("registers a new user", async () => {
    const response = await post("/api/auth/sign-up/email", {
      name: "Golden Path User",
      email: "golden-path@example.com",
      password: "SecureP@ss123",
    });
    expect(response.status).toBe(200);
    cookies = parseCookies(response);
    expect(cookies).toBeTruthy();
  });

  it("creates an organization", async () => {
    const response = await post(
      "/api/auth/organization/create",
      { name: "Golden Org", slug: "golden-org" },
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
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

  // ── Section 2: Project scaffold ────────────────────────────────

  it("creates the golden path project", async () => {
    const response = await post(
      "/api/projects",
      { name: "Golden Path Project", slug: projectSlug },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    projectId = (await response.json()).id as string;
  });

  // The project is seeded with production/staging/preview branches+channels at
  // create time, so the golden path picks up the seeded production+staging and
  // only needs to add the rollback branch+channel.

  it("resolves seeded production + staging branches", async () => {
    const response = await get(`/api/branches?projectId=${projectId}`, { cookie: cookies });
    expect(response.status).toBe(200);
    const body = await response.json();
    const byName = new Map<string, string>(
      body.items.map((b: { id: string; name: string }) => [b.name, b.id]),
    );
    const production = byName.get("production");
    const staging = byName.get("staging");
    expect(production).toBeDefined();
    expect(staging).toBeDefined();
    productionBranchId = production!;
    stagingBranchId = staging!;
  });

  it("creates rollback branch", async () => {
    const response = await post(
      "/api/branches",
      { projectId, name: "rollback" },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    rollbackBranchId = (await response.json()).id as string;
  });

  it("creates rollback channel linked to rollback branch", async () => {
    const response = await post(
      "/api/channels",
      { projectId, name: "rollback", branchId: rollbackBranchId },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
  });

  // ── Section 3: Staging publish (v1) ────────────────────────────

  it("uploads v1 asset end-to-end", async () => {
    const { hash } = await uploadAndFinalizeAsset({
      projectId,
      cookies,
      content: "console.log('golden v1 bundle');",
    });
    v1AssetHash = hash;
  });

  it("publishes v1 (ios) to staging branch", async () => {
    const response = await post(
      "/api/updates",
      {
        slug: projectSlug,
        branch: "staging",
        runtimeVersion: "1.0.0",
        platform: "ios",
        message: "Golden v1 staging",
        groupId: stagingV1GroupId,
        metadata: { release: "v1" },
        assets: [{ hash: v1AssetHash, key: "bundles/ios.js", isLaunch: true }],
      },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.branchId).toBe(stagingBranchId);
    expect(body.rolloutPercentage).toBe(100);
    stagingV1UpdateId = body.id;
  });

  it("publishes v1 (android) into same group", async () => {
    const response = await post(
      "/api/updates",
      {
        slug: projectSlug,
        branch: "staging",
        runtimeVersion: "1.0.0",
        platform: "android",
        message: "Golden v1 staging",
        groupId: stagingV1GroupId,
        metadata: { release: "v1" },
        assets: [{ hash: v1AssetHash, key: "bundles/android.js", isLaunch: true }],
      },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
  });

  it("staging manifest returns v1 for ios", async () => {
    const response = await manifestGet(projectId, protocolHeaders("staging", "1.0.0", "ios"));
    expect(response.status).toBe(200);
    const contentType = response.headers.get("content-type") ?? "";
    const parts = parseMultipart(contentType, await response.text());
    const manifestPart = parts.find((part) =>
      part.headers["content-disposition"]?.includes('name="manifest"'),
    );
    expect(manifestPart).toBeDefined();
    const manifest = JSON.parse(manifestPart!.body);
    expect(manifest.id).toBe(stagingV1UpdateId);
    expect(manifest.launchAsset.hash).toBe(v1AssetHash);
  });

  // ── Section 4: Promote staging → production ───────────────────

  it("promotes v1 from staging group into production branch", async () => {
    const response = await post(
      "/api/updates/republish",
      {
        sourceGroupId: stagingV1GroupId,
        destinationBranchId: productionBranchId,
        message: "Go live v1",
      },
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.updates).toHaveLength(2);
    const updates = body.updates as Array<{
      id: string;
      branchId: string;
      platform: "ios" | "android";
      message: string;
    }>;
    expect(updates.every((update) => update.branchId === productionBranchId)).toBe(true);
    expect(updates.every((update) => update.message === "Go live v1")).toBe(true);
    const iosPromoted = updates.find((update) => update.platform === "ios");
    if (!iosPromoted) {
      throw new Error("Expected iOS update in promoted group");
    }
    promotedV1UpdateId = iosPromoted.id;
  });

  it("production manifest returns the promoted v1 for ios", async () => {
    const response = await manifestGet(projectId, protocolHeaders("production", "1.0.0", "ios"));
    expect(response.status).toBe(200);
    const contentType = response.headers.get("content-type") ?? "";
    const parts = parseMultipart(contentType, await response.text());
    const manifestPart = parts.find((part) =>
      part.headers["content-disposition"]?.includes('name="manifest"'),
    );
    expect(manifestPart).toBeDefined();
    const manifest = JSON.parse(manifestPart!.body);
    expect(manifest.id).toBe(promotedV1UpdateId);
    expect(manifest.launchAsset.hash).toBe(v1AssetHash);
  });

  // ── Section 5: Rollout lifecycle on production ────────────────

  it("uploads v2 asset end-to-end", async () => {
    const { hash } = await uploadAndFinalizeAsset({
      projectId,
      cookies,
      content: "console.log('golden v2 bundle');",
    });
    v2AssetHash = hash;
  });

  it("publishes v2 (ios) to production with 50% rollout", async () => {
    const response = await post(
      "/api/updates",
      {
        slug: projectSlug,
        branch: "production",
        runtimeVersion: "1.0.0",
        platform: "ios",
        message: "Golden v2 canary",
        groupId: productionV2GroupId,
        metadata: { release: "v2" },
        rolloutPercentage: 50,
        assets: [{ hash: v2AssetHash, key: "bundles/ios.js", isLaunch: true }],
      },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.rolloutPercentage).toBe(50);
    productionV2UpdateId = body.id;
  });

  it("rejects a second publish to production/ios/1.0.0 during the active rollout", async () => {
    const response = await post(
      "/api/updates",
      {
        slug: projectSlug,
        branch: "production",
        runtimeVersion: "1.0.0",
        platform: "ios",
        message: "Should be blocked",
        groupId: "golden-group-blocked",
        metadata: {},
        assets: [{ hash: v2AssetHash, key: "bundles/ios.js", isLaunch: true }],
      },
      { cookie: cookies },
    );
    expect(response.status).toBe(409);
  });

  it("completes the v2 rollout", async () => {
    const response = await post(
      `/api/updates/${productionV2UpdateId}/rollout/complete`,
      {},
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.rolloutPercentage).toBe(100);
  });

  it("uploads v3 asset end-to-end", async () => {
    const { hash } = await uploadAndFinalizeAsset({
      projectId,
      cookies,
      content: "console.log('golden v3 bundle');",
    });
    v3AssetHash = hash;
  });

  it("publishes v3 (ios) to production after the rollout completes", async () => {
    const response = await post(
      "/api/updates",
      {
        slug: projectSlug,
        branch: "production",
        runtimeVersion: "1.0.0",
        platform: "ios",
        message: "Golden v3 stable",
        groupId: productionV3GroupId,
        metadata: { release: "v3" },
        assets: [{ hash: v3AssetHash, key: "bundles/ios.js", isLaunch: true }],
      },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.rolloutPercentage).toBe(100);
  });

  it("production manifest now serves v3 for ios", async () => {
    const response = await manifestGet(projectId, protocolHeaders("production", "1.0.0", "ios"));
    expect(response.status).toBe(200);
    const contentType = response.headers.get("content-type") ?? "";
    const parts = parseMultipart(contentType, await response.text());
    const manifestPart = parts.find((part) =>
      part.headers["content-disposition"]?.includes('name="manifest"'),
    );
    expect(manifestPart).toBeDefined();
    const manifest = JSON.parse(manifestPart!.body);
    expect(manifest.launchAsset.hash).toBe(v3AssetHash);
  });

  // ── Section 6: Rollback directive flow ────────────────────────

  it("publishes a rollback-to-embedded directive on the rollback branch", async () => {
    const directiveBody = JSON.stringify({
      type: "rollBackToEmbedded",
      parameters: { commitTime: "2026-04-15T00:00:00.000Z" },
    });
    const response = await post(
      "/api/updates",
      {
        slug: projectSlug,
        branch: "rollback",
        runtimeVersion: "9.0.0",
        platform: "ios",
        message: "Golden rollback",
        groupId: rollbackGroupId,
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
  });

  it("rollback manifest returns the directive", async () => {
    const response = await manifestGet(projectId, protocolHeaders("rollback", "9.0.0", "ios"));
    expect(response.status).toBe(200);
    const contentType = response.headers.get("content-type") ?? "";
    const parts = parseMultipart(contentType, await response.text());
    const directivePart = parts.find((part) =>
      part.headers["content-disposition"]?.includes('name="directive"'),
    );
    expect(directivePart).toBeDefined();
    expect(JSON.parse(directivePart!.body)).toEqual({
      type: "rollBackToEmbedded",
      parameters: { commitTime: "2026-04-15T00:00:00.000Z" },
    });
  });

  // ── Section 7: List & delete ──────────────────────────────────

  it("lists all updates for the project and accounts for every flow", async () => {
    const response = await get(`/api/updates?projectId=${projectId}&limit=50`, {
      cookie: cookies,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    const groupIds = new Set(body.items.map((update: { groupId: string }) => update.groupId));
    expect(groupIds.has(stagingV1GroupId)).toBe(true);
    expect(groupIds.has(productionV2GroupId)).toBe(true);
    expect(groupIds.has(productionV3GroupId)).toBe(true);
    expect(groupIds.has(rollbackGroupId)).toBe(true);
  });

  it("deletes the staging v1 group and verifies removal", async () => {
    const deleteResponse = await del(`/api/updates/${stagingV1GroupId}`, {
      cookie: cookies,
    });
    expect(deleteResponse.status).toBe(200);
    const deleteBody = await deleteResponse.json();
    expect(deleteBody.deleted).toBeGreaterThanOrEqual(2);

    const listResponse = await get(
      `/api/updates?projectId=${projectId}&branchId=${stagingBranchId}`,
      { cookie: cookies },
    );
    expect(listResponse.status).toBe(200);
    const listBody = await listResponse.json();
    const stagingV1Remains = listBody.items.some(
      (update: { groupId: string }) => update.groupId === stagingV1GroupId,
    );
    expect(stagingV1Remains).toBe(false);
  });
});
