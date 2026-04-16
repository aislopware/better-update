import { createHash } from "node:crypto";
import path from "node:path";

import { setupCliE2E } from "../helpers/cli-e2e";

const FIXTURE_DIR = path.resolve(import.meta.dirname, "../../../e2e-app");

const otaAppJsonTemplate = {
  expo: {
    name: "OTA Lifecycle App",
    slug: "ota-lifecycle-app",
    owner: "ota-lifecycle",
    version: "1.0.0",
    runtimeVersion: "1.0.0",
    ios: {
      bundleIdentifier: "com.example.otalifecycle",
      buildNumber: "1",
    },
    android: {
      package: "com.example.otalifecycle",
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

const cli = setupCliE2E(".wrangler/state/e2e-cli-ota-lifecycle", {
  projectDir: FIXTURE_DIR,
  appJsonTemplate: otaAppJsonTemplate,
});

// ── Helpers ──────────────────────────────────────────────────────

const iosRowPattern = /^ios\s+([0-9a-f-]+)\s+1\.0\.0\s+(\d+)\s+(\d+)\s*$/m;

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

const manifestHeaders = (overrides?: Record<string, string>) => ({
  "expo-protocol-version": "1",
  "expo-platform": "ios",
  "expo-runtime-version": "1.0.0",
  "expo-channel-name": "main",
  accept: "multipart/mixed",
  ...overrides,
});

const fetchManifest = (projectId: string, overrides?: Record<string, string>) =>
  cli.get(`/manifest/${projectId}`, manifestHeaders(overrides));

const extractManifestId = async (response: Response): Promise<string> => {
  const contentType = response.headers.get("content-type") ?? "";
  const parts = parseMultipart(contentType, await response.text());
  const manifestPart = parts.find((part) =>
    part.headers["content-disposition"]?.includes('name="manifest"'),
  );
  expect(manifestPart).toBeDefined();
  return JSON.parse(manifestPart!.body).id;
};

/** Reproduces server domain/hash.ts hashToFraction using Node crypto. */
const hashToFraction = (salt: string, clientId: string): number => {
  const hash = createHash("sha256").update(`${salt}:${clientId}`).digest();
  return hash.readUInt32BE(0) / 4_294_967_296;
};

/** Finds two deterministic client IDs: one in-rollout, one out-rollout. */
const findRolloutClients = (
  updateId: string,
  percentage: number,
): { inClient: string; outClient: string } => {
  const threshold = percentage / 100;
  let inClient = "";
  let outClient = "";
  for (let i = 0; i < 200; i++) {
    const clientId = `ota-test-client-${i}`;
    const fraction = hashToFraction(updateId, clientId);
    if (fraction < threshold && !inClient) inClient = clientId;
    if (fraction >= threshold && !outClient) outClient = clientId;
    if (inClient && outClient) break;
  }
  if (!inClient || !outClient) {
    throw new Error(`Could not find rollout test clients for ${updateId} at ${percentage}%`);
  }
  return { inClient, outClient };
};

// ── Shared state across sequential tests ─────────────────────────

const state = {
  v1UpdateId: "",
  v2UpdateId: "",
};

// ── Tests ────────────────────────────────────────────────────────

describe("OTA lifecycle: CLI publish → manifest → rollout → rollback", () => {
  // ── Section 1: Setup ────────────────────────────────────────────

  it("links the fixture app to the seeded project", () => {
    const result = cli.runCli("init");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Project linked successfully");
  });

  // ── Section 2: Publish v1 → manifest serves update ─────────────

  it("publishes v1 iOS update via CLI", () => {
    const result = cli.runCli("update", "publish", "--branch", "main", "--platform", "ios");
    expect(result.exitCode).toBe(0);

    const iosRow = result.stdout.match(iosRowPattern);
    expect(iosRow).toBeDefined();
    state.v1UpdateId = iosRow![1]!;
  });

  it("manifest endpoint serves v1 to an Expo app", async () => {
    const response = await fetchManifest(cli.getProjectId());
    expect(response.status).toBe(200);
    expect(await extractManifestId(response)).toBe(state.v1UpdateId);
  });

  it("returns 204 when app already has the latest update", async () => {
    const response = await fetchManifest(cli.getProjectId(), {
      "expo-current-update-id": state.v1UpdateId,
    });
    expect(response.status).toBe(204);
  });

  // ── Section 3: Publish v2 → manifest serves latest ─────────────

  it("publishes v2 iOS update via CLI", () => {
    const result = cli.runCli(
      "update",
      "publish",
      "--branch",
      "main",
      "--platform",
      "ios",
      "--message",
      "v2 update",
    );
    expect(result.exitCode).toBe(0);

    const iosRow = result.stdout.match(iosRowPattern);
    expect(iosRow).toBeDefined();
    state.v2UpdateId = iosRow![1]!;
    expect(state.v2UpdateId).not.toBe(state.v1UpdateId);
  });

  it("manifest endpoint now serves v2 (latest)", async () => {
    const response = await fetchManifest(cli.getProjectId());
    expect(response.status).toBe(200);
    expect(await extractManifestId(response)).toBe(state.v2UpdateId);
  });

  // ── Section 4: Per-update rollout → manifest routing ────────────

  it("sets v2 rollout to 50% via CLI", () => {
    const result = cli.runCli("update", "rollout", "set", state.v2UpdateId, "--percentage", "50");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`Updated rollout for ${state.v2UpdateId} to 50%.`);
  });

  it("falls back to v1 when no eas-client-id is provided", async () => {
    const response = await fetchManifest(cli.getProjectId());
    expect(response.status).toBe(200);
    expect(await extractManifestId(response)).toBe(state.v1UpdateId);
  });

  it("serves v2 to in-rollout client and v1 to out-rollout client", async () => {
    const { inClient, outClient } = findRolloutClients(state.v2UpdateId, 50);

    const inResponse = await fetchManifest(cli.getProjectId(), {
      "eas-client-id": inClient,
    });
    expect(inResponse.status).toBe(200);
    expect(await extractManifestId(inResponse)).toBe(state.v2UpdateId);

    const outResponse = await fetchManifest(cli.getProjectId(), {
      "eas-client-id": outClient,
    });
    expect(outResponse.status).toBe(200);
    expect(await extractManifestId(outResponse)).toBe(state.v1UpdateId);
  });

  it("completing rollout makes v2 available to all clients", async () => {
    const result = cli.runCli("update", "rollout", "complete", state.v2UpdateId);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("100%");

    const response = await fetchManifest(cli.getProjectId());
    expect(response.status).toBe(200);
    expect(await extractManifestId(response)).toBe(state.v2UpdateId);
  });

  // ── Section 5: Rollback → manifest directive ────────────────────

  it("creates a rollback directive via CLI", () => {
    const result = cli.runCli(
      "update",
      "rollback",
      "--branch",
      "main",
      "--platform",
      "ios",
      "--commit-time",
      "2026-04-15T00:00:00.000Z",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Created rollback group");
  });

  it("manifest returns rollback-to-embedded directive", async () => {
    const response = await fetchManifest(cli.getProjectId());
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

    // No manifest part — only directive
    const manifestPart = parts.find((part) =>
      part.headers["content-disposition"]?.includes('name="manifest"'),
    );
    expect(manifestPart).toBeUndefined();
  });
});
