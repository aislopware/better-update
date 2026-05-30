import { createHash } from "node:crypto";

import { buildManifest } from "@better-update/expo-protocol";

import {
  signTestManifestBody,
  TEST_CODE_SIGNING_CERTIFICATE_PEM,
} from "../helpers/code-signing-fixture";
import { seedAssetObject, setupE2EWorker } from "../helpers/e2e-worker-pool";

// E2E coverage for the publish-time code-signing verification gate + Gap-D
// render. Authored per repo policy; do NOT auto-run (slow). Mirrors the
// vitest-pool-workers harness used by manifest-serving.test.ts / updates-flow.
const { get, parseCookies, post, postNoBody } = setupE2EWorker(".wrangler/state/e2e-code-signing");

// PUBLIC_API_URL the worker serves + negotiates from (wrangler.jsonc var).
const PUBLIC_API_URL = "https://better-update.dev";
const ASSET_CDN_URL = "https://assets.better-update.dev";

const launchContent = "console.log('signed bundle')";
const launchHash = createHash("sha256").update(launchContent).digest("base64url");
const launchContentChecksum = createHash("sha256").update(launchContent).digest("base64url");

interface MultipartPart {
  readonly headers: Record<string, string>;
  readonly body: string;
}

const parseMultipart = (contentType: string, rawBody: string): readonly MultipartPart[] => {
  const boundary = /boundary=([^\s;]+)/.exec(contentType)?.[1] ?? "";
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

// Render a manifest body exactly the way the CLI does for a signed publish:
// launchAsset.url points at the Worker bundle route so signed updates negotiate
// bsdiff too (Gap-D fix). The returned string is signed + sent verbatim.
const renderSignedManifestFor = (params: {
  readonly updateId: string;
  readonly projectId: string;
}) =>
  JSON.stringify(
    buildManifest({
      update: {
        id: params.updateId,
        createdAt: "2026-05-01T00:00:00.000Z",
        runtimeVersion: "1.0.0",
        metadata: {},
        extra: { eas: { projectId: params.projectId } },
      },
      assets: [
        {
          key: "bundles/ios.js",
          hash: launchHash,
          contentChecksum: launchContentChecksum,
          contentType: "application/javascript",
          fileExt: "js",
          isLaunch: true,
        },
      ],
      assetBaseUrl: ASSET_CDN_URL,
      serverBaseUrl: PUBLIC_API_URL,
      projectId: params.projectId,
    }),
  );

describe("Code-signing publish verification (E2E)", () => {
  let cookies: string;
  let projectId: string;

  // ── Auth + project + asset bootstrap ─────────────────────────────

  it("bootstraps user, org, project, branch, channel, and a finalized launch asset", async () => {
    const signUp = await post("/api/auth/sign-up/email", {
      name: "Code Signing E2E",
      email: "code-signing-e2e@example.com",
      password: "SecureP@ss123",
    });
    expect(signUp.status).toBe(200);
    cookies = parseCookies(signUp);

    const org = await post(
      "/api/auth/organization/create",
      { name: "Code Signing Org", slug: "code-signing-org" },
      { cookie: cookies },
    );
    expect(org.status).toBe(200);
    const organizationId = (await org.json()).id as string;
    cookies = parseCookies(org) || cookies;

    const setActive = await post(
      "/api/auth/organization/set-active",
      { organizationId },
      { cookie: cookies },
    );
    cookies = parseCookies(setActive) || cookies;

    const project = await post(
      "/api/projects",
      { name: "Code Signing Project", slug: "code-signing-app" },
      { cookie: cookies },
    );
    expect(project.status).toBe(201);
    projectId = (await project.json()).id as string;

    // Register + finalize the launch asset so the publish passes assertAssetsExist.
    const register = await post(
      "/api/assets/upload",
      {
        projectId,
        assets: [
          {
            hash: launchHash,
            contentType: "application/javascript",
            fileExt: "js",
            contentChecksum: launchContentChecksum,
          },
        ],
      },
      { cookie: cookies },
    );
    expect(register.status).toBe(201);

    await seedAssetObject({
      hash: launchHash,
      content: launchContent,
      contentType: "application/javascript",
    });
    const finalize = await postNoBody(`/api/assets/${launchHash}/finalize`, { cookie: cookies });
    expect(finalize.status).toBe(200);
  });

  // ── (1) Tampered signature is rejected; nothing is written ───────

  it("rejects a signed update whose signature does not verify (400, no row written)", async () => {
    const updateId = crypto.randomUUID();
    const manifestBody = renderSignedManifestFor({ updateId, projectId });
    // Sign DIFFERENT bytes than we send → the stored body would not verify.
    const signature = signTestManifestBody(`${manifestBody} tampered`);

    const response = await post(
      "/api/updates",
      {
        slug: "code-signing-app",
        branch: "tamper",
        runtimeVersion: "1.0.0",
        platform: "ios",
        message: "Tampered signed publish",
        groupId: "group-tamper",
        metadata: {},
        id: updateId,
        assets: [
          {
            hash: launchHash,
            key: "bundles/ios.js",
            isLaunch: true,
            contentChecksum: launchContentChecksum,
          },
        ],
        manifestBody,
        signature,
        certificateChain: TEST_CODE_SIGNING_CERTIFICATE_PEM,
      },
      { cookie: cookies },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(
      expect.objectContaining({ message: expect.stringContaining("does not verify") }),
    );

    // The row must NOT have been written.
    const updatesList = await get(`/api/updates?projectId=${projectId}`, { cookie: cookies });
    const body = (await updatesList.json()) as { items: { id: string }[] };
    expect(body.items.find((u) => u.id === updateId)).toBeUndefined();
  });

  // ── (3) Wrong-alg signed publish is rejected (ECDSA gated off) ───

  it("rejects a wrong-alg signed publish (400)", async () => {
    const updateId = crypto.randomUUID();
    const manifestBody = renderSignedManifestFor({ updateId, projectId });
    // Correct signature bytes but an unsupported alg in the SFV header.
    const validSig = signTestManifestBody(manifestBody);
    const sigBase64 = /sig="([^"]+)"/.exec(validSig)![1]!;
    const ecdsaHeader = `sig="${sigBase64}", keyid="main", alg="ecdsa-p256-sha256"`;

    const response = await post(
      "/api/updates",
      {
        slug: "code-signing-app",
        branch: "wrong-alg",
        runtimeVersion: "1.0.0",
        platform: "ios",
        message: "Wrong alg signed publish",
        groupId: "group-wrong-alg",
        metadata: {},
        id: updateId,
        assets: [
          {
            hash: launchHash,
            key: "bundles/ios.js",
            isLaunch: true,
            contentChecksum: launchContentChecksum,
          },
        ],
        manifestBody,
        signature: ecdsaHeader,
        certificateChain: TEST_CODE_SIGNING_CERTIFICATE_PEM,
      },
      { cookie: cookies },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(
      expect.objectContaining({ message: expect.stringContaining("rsa-v1_5-sha256") }),
    );
  });

  // ── (2) Correctly signed publish is stored + served byte-for-byte ─

  it("publishes a correctly signed update and serves it byte-for-byte with the bundle-route URL", async () => {
    const updateId = crypto.randomUUID();
    const manifestBody = renderSignedManifestFor({ updateId, projectId });
    const signature = signTestManifestBody(manifestBody);

    const publish = await post(
      "/api/updates",
      {
        slug: "code-signing-app",
        branch: "signed-ok",
        runtimeVersion: "1.0.0",
        platform: "ios",
        message: "Correctly signed publish",
        groupId: "group-signed-ok",
        metadata: {},
        id: updateId,
        assets: [
          {
            hash: launchHash,
            key: "bundles/ios.js",
            isLaunch: true,
            contentChecksum: launchContentChecksum,
          },
        ],
        manifestBody,
        signature,
        certificateChain: TEST_CODE_SIGNING_CERTIFICATE_PEM,
      },
      { cookie: cookies },
    );
    expect(publish.status).toBe(201);
    const created = (await publish.json()) as {
      id: string;
      signature: string | null;
      certificateChain: string | null;
      manifestBody: string | null;
    };
    // The server honored the client-chosen id.
    expect(created.id).toBe(updateId);
    expect(created.signature).toBe(signature);
    expect(created.manifestBody).toBe(manifestBody);
    expect(created.certificateChain).toBe(TEST_CODE_SIGNING_CERTIFICATE_PEM);

    // Fetch the manifest with expo-expect-signature → multipart with signature.
    const manifestResponse = await get(`/manifest/${projectId}`, {
      "expo-protocol-version": "1",
      "expo-platform": "ios",
      "expo-runtime-version": "1.0.0",
      "expo-channel-name": "signed-ok",
      "expo-expect-signature": "true",
      accept: "multipart/mixed",
    });
    expect(manifestResponse.status).toBe(200);

    const contentType = manifestResponse.headers.get("content-type")!;
    const parts = parseMultipart(contentType, await manifestResponse.text());

    const manifestPart = parts.find((p) =>
      p.headers["content-disposition"]?.includes('name="manifest"'),
    );
    expect(manifestPart).toBeDefined();
    // Served BYTE-FOR-BYTE === the signed body.
    expect(manifestPart!.body).toBe(manifestBody);
    // The per-part expo-signature header === the stored SFV.
    expect(manifestPart!.headers["expo-signature"]).toBe(signature);

    // certificate_chain part is present.
    const certPart = parts.find((p) =>
      p.headers["content-disposition"]?.includes('name="certificate_chain"'),
    );
    expect(certPart).toBeDefined();
    expect(certPart!.body).toContain("BEGIN CERTIFICATE");

    // launchAsset.url === the Worker bundle route (so bsdiff negotiates).
    const manifest = JSON.parse(manifestPart!.body) as { launchAsset: { url: string } };
    expect(manifest.launchAsset.url).toBe(
      `${PUBLIC_API_URL}/manifest/${projectId}/bundle/${updateId}/${launchHash}`,
    );
  });
});
