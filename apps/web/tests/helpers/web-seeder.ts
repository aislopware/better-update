import { createHash } from "node:crypto";

import { DEFAULT_PASSWORD, shortId } from "./browser-helpers";

import type { setupE2EDashboard } from "./e2e-dashboard";

type Dashboard = ReturnType<typeof setupE2EDashboard>;

const parseSetCookie = (response: Response): string => {
  const setCookie = response.headers.getSetCookie();
  return setCookie
    .map((cookie) => cookie.split(";")[0] ?? "")
    .filter(Boolean)
    .join("; ");
};

export interface SeededOrg {
  readonly cookies: string;
  readonly userEmail: string;
  readonly orgId: string;
  readonly projectId: string;
  readonly slug: string;
}

export interface CreateDashboardSeederParams {
  readonly dashboard: Dashboard;
  readonly name: string;
  readonly email: string;
  readonly orgName: string;
  readonly orgSlug: string;
  readonly projectName: string;
  readonly slug: string;
}

export const seedUserOrgProject = async (
  params: CreateDashboardSeederParams,
): Promise<SeededOrg> => {
  const { dashboard } = params;

  const signupResponse = await dashboard.post("/api/auth/sign-up/email", {
    name: params.name,
    email: params.email,
    password: DEFAULT_PASSWORD,
  });
  expect(signupResponse.status).toBe(200);
  let cookies = parseSetCookie(signupResponse);

  const createOrgResponse = await dashboard.post(
    "/api/auth/organization/create",
    { name: params.orgName, slug: params.orgSlug },
    { cookie: cookies },
  );
  expect(createOrgResponse.status).toBe(200);
  const orgBody = (await createOrgResponse.json()) as { id: string };
  cookies = parseSetCookie(createOrgResponse) || cookies;

  const setActiveResponse = await dashboard.post(
    "/api/auth/organization/set-active",
    { organizationId: orgBody.id },
    { cookie: cookies },
  );
  expect(setActiveResponse.status).toBe(200);
  cookies = parseSetCookie(setActiveResponse) || cookies;

  const projectResponse = await dashboard.post(
    "/api/projects",
    { name: params.projectName, slug: params.slug },
    { cookie: cookies },
  );
  expect(projectResponse.status).toBe(201);
  const projectBody = (await projectResponse.json()) as { id: string };

  return {
    cookies,
    userEmail: params.email,
    orgId: orgBody.id,
    projectId: projectBody.id,
    slug: params.slug,
  };
};

export const seedBranch = async (params: {
  readonly dashboard: Dashboard;
  readonly cookies: string;
  readonly projectId: string;
  readonly name: string;
}): Promise<string> => {
  const response = await params.dashboard.post(
    "/api/branches",
    { projectId: params.projectId, name: params.name },
    { cookie: params.cookies },
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
};

export const seedChannel = async (params: {
  readonly dashboard: Dashboard;
  readonly cookies: string;
  readonly projectId: string;
  readonly name: string;
  readonly branchId: string;
}): Promise<string> => {
  const response = await params.dashboard.post(
    "/api/channels",
    { projectId: params.projectId, name: params.name, branchId: params.branchId },
    { cookie: params.cookies },
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
};

// Projects ship with seeded production/staging/preview channels. Use this to
// look up one by name and re-target it at a different branch for tests that
// want to reuse the seeded channel rather than create a parallel one.
export const rebindSeededChannel = async (params: {
  readonly dashboard: Dashboard;
  readonly cookies: string;
  readonly projectId: string;
  readonly name: string;
  readonly branchId: string;
}): Promise<string> => {
  const listResponse = await params.dashboard.get(`/api/channels?projectId=${params.projectId}`, {
    cookie: params.cookies,
  });
  expect(listResponse.status).toBe(200);
  const listBody = (await listResponse.json()) as {
    readonly items: readonly { readonly id: string; readonly name: string }[];
  };
  const existing = listBody.items.find((item) => item.name === params.name);
  if (!existing) {
    throw new Error(`rebindSeededChannel: channel "${params.name}" not found`);
  }
  const patchResponse = await params.dashboard.patch(
    `/api/channels/${existing.id}`,
    { branchId: params.branchId },
    { cookie: params.cookies },
  );
  expect(patchResponse.status).toBe(200);
  return existing.id;
};

export const seedAssetAndFinalize = async (params: {
  readonly dashboard: Dashboard;
  readonly cookies: string;
  readonly projectId: string;
  readonly content: string;
}): Promise<string> => {
  const hash = createHash("sha256").update(params.content).digest("base64url");
  const registerResponse = await params.dashboard.post(
    "/api/assets/upload",
    {
      projectId: params.projectId,
      assets: [{ hash, contentType: "application/javascript", fileExt: "js" }],
    },
    { cookie: params.cookies },
  );
  expect(registerResponse.status).toBe(201);
  const registerBody = (await registerResponse.json()) as {
    uploaded: readonly {
      readonly hash: string;
      readonly uploadUrl: string;
      readonly uploadHeaders: Record<string, string>;
    }[];
  };

  const uploadEntry = registerBody.uploaded.find((entry) => entry.hash === hash);
  if (uploadEntry) {
    const bytes = new TextEncoder().encode(params.content);
    const putResponse = await fetch(uploadEntry.uploadUrl, {
      method: "PUT",
      headers: {
        "content-length": String(bytes.byteLength),
        ...uploadEntry.uploadHeaders,
      },
      body: bytes,
    });
    expect(putResponse.status).toBe(200);

    const finalizeResponse = await fetch(
      `${params.dashboard.getBaseUrl()}/api/assets/${hash}/finalize`,
      {
        method: "POST",
        headers: { cookie: params.cookies },
      },
    );
    expect(finalizeResponse.status).toBe(200);
  }

  return hash;
};

export const seedUpdate = async (params: {
  readonly dashboard: Dashboard;
  readonly cookies: string;
  readonly slug: string;
  readonly branch: string;
  readonly assetHash: string;
  readonly message: string;
  readonly groupId: string;
}): Promise<string> => {
  const response = await params.dashboard.post(
    "/api/updates",
    {
      slug: params.slug,
      branch: params.branch,
      runtimeVersion: "1.0.0",
      platform: "ios",
      message: params.message,
      groupId: params.groupId,
      metadata: {},
      assets: [{ hash: params.assetHash, key: "bundles/ios.js", isLaunch: true }],
    },
    { cookie: params.cookies },
  );
  if (response.status !== 201) {
    throw new Error(`seedUpdate failed: ${response.status} ${await response.text()}`);
  }
  return ((await response.json()) as { id: string }).id;
};

export const patchUpdateRollout = async (params: {
  readonly dashboard: Dashboard;
  readonly cookies: string;
  readonly updateId: string;
  readonly percentage: number;
}): Promise<void> => {
  const response = await params.dashboard.patch(
    `/api/updates/${params.updateId}/rollout`,
    { percentage: params.percentage },
    { cookie: params.cookies },
  );
  if (response.status !== 200) {
    throw new Error(`patchUpdateRollout failed: ${response.status} ${await response.text()}`);
  }
};

export const seedBuild = async (params: {
  readonly dashboard: Dashboard;
  readonly cookies: string;
  readonly projectId: string;
  readonly platform: "ios" | "android";
  readonly distribution: string;
  readonly artifactFormat: string;
  readonly message: string;
  readonly buildNumber: string;
}): Promise<string> => {
  const bytes = Buffer.from(`${params.platform}-${params.buildNumber}-${shortId()}`);
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  const reserveResponse = await params.dashboard.post(
    "/api/builds",
    {
      projectId: params.projectId,
      platform: params.platform,
      distribution: params.distribution,
      artifactFormat: params.artifactFormat,
      appVersion: "1.0.0",
      buildNumber: params.buildNumber,
      bundleId: `com.test.${params.platform}`,
      message: params.message,
      runtimeVersion: "1.0.0",
      sha256,
      byteSize: bytes.byteLength,
    },
    { cookie: params.cookies },
  );
  if (reserveResponse.status !== 201) {
    throw new Error(
      `seedBuild reserve failed: ${reserveResponse.status} ${await reserveResponse.text()}`,
    );
  }
  const reserveBody = (await reserveResponse.json()) as {
    id: string;
    uploadUrl: string;
    uploadHeaders: Record<string, string>;
  };

  const putResponse = await fetch(reserveBody.uploadUrl, {
    method: "PUT",
    headers: {
      "content-length": String(bytes.byteLength),
      ...reserveBody.uploadHeaders,
    },
    body: bytes,
  });
  expect(putResponse.status).toBe(200);

  const completeResponse = await params.dashboard.post(
    `/api/builds/${reserveBody.id}/complete`,
    { sha256, byteSize: bytes.byteLength },
    { cookie: params.cookies },
  );
  if (completeResponse.status !== 200) {
    throw new Error(
      `seedBuild complete failed: ${completeResponse.status} ${await completeResponse.text()}`,
    );
  }

  return reserveBody.id;
};
