import { execSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";

import { setupE2EWorker } from "../helpers/e2e-worker";

const persistDir = ".wrangler/state/e2e-manifest";
const { getBaseUrl } = setupE2EWorker(persistDir);

// ── Seed data via raw SQL (independent of management API) ───────

const seedFile = ".wrangler/seed-manifest.sql";

const seedSQL = `
INSERT INTO "organization" ("id", "name", "slug", "created_at")
VALUES ('org-1', 'Test Org', 'test-org', '2024-01-01');

INSERT INTO "projects" ("id", "organization_id", "name", "scope_key", "created_at")
VALUES ('proj-1', 'org-1', 'Test Project', '@test/my-app', '2024-01-01T00:00:00.000Z');

INSERT INTO "branches" ("id", "project_id", "name", "created_at")
VALUES ('branch-1', 'proj-1', 'main', '2024-01-01T00:00:00.000Z');

INSERT INTO "channels" ("id", "project_id", "name", "branch_id", "is_paused", "created_at")
VALUES ('chan-prod', 'proj-1', 'production', 'branch-1', 0, '2024-01-01T00:00:00.000Z');

INSERT INTO "channels" ("id", "project_id", "name", "branch_id", "is_paused", "created_at")
VALUES ('chan-paused', 'proj-1', 'staging', 'branch-1', 1, '2024-01-01T00:00:00.000Z');

INSERT INTO "updates" ("id", "branch_id", "runtime_version", "platform", "message", "metadata_json", "group_id", "is_rollback", "created_at")
VALUES ('update-ios', 'branch-1', '1.0.0', 'ios', 'first ios update', '{}', 'group-1', 0, '2024-01-15T10:00:00.000Z');

INSERT INTO "updates" ("id", "branch_id", "runtime_version", "platform", "message", "metadata_json", "group_id", "is_rollback", "directive_body", "created_at")
VALUES ('update-rollback', 'branch-1', '1.0.0', 'android', 'rollback android', '{}', 'group-2', 1, NULL, '2024-01-16T10:00:00.000Z');

INSERT INTO "assets" ("hash", "content_type", "file_ext", "byte_size", "r2_key", "created_at")
VALUES ('abc123hash', 'application/javascript', 'js', 1024, 'assets/abc123hash', '2024-01-15T00:00:00.000Z');

INSERT INTO "assets" ("hash", "content_type", "file_ext", "byte_size", "r2_key", "created_at")
VALUES ('img456hash', 'image/png', 'png', 2048, 'assets/img456hash', '2024-01-15T00:00:00.000Z');

INSERT INTO "update_assets" ("update_id", "asset_key", "asset_hash", "is_launch")
VALUES ('update-ios', 'bundle', 'abc123hash', 1);

INSERT INTO "update_assets" ("update_id", "asset_key", "asset_hash", "is_launch")
VALUES ('update-ios', 'logo.png', 'img456hash', 0);

INSERT INTO "updates" ("id", "branch_id", "runtime_version", "platform", "message", "metadata_json", "group_id", "is_rollback", "manifest_body", "created_at")
VALUES ('update-precomputed', 'branch-1', '2.0.0', 'ios', 'precomputed', '{}', 'group-3', 0, '{"id":"update-precomputed","createdAt":"2024-02-01T00:00:00.000Z","runtimeVersion":"2.0.0","launchAsset":null,"assets":[],"metadata":{},"extra":{"scopeKey":"@test/my-app"}}', '2024-02-01T00:00:00.000Z');

INSERT INTO "updates" ("id", "branch_id", "runtime_version", "platform", "message", "metadata_json", "group_id", "is_rollback", "signature", "certificate_chain", "created_at")
VALUES ('update-signed', 'branch-1', '3.0.0', 'ios', 'signed update', '{}', 'group-4', 0, 'sig=test-signature', '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----', '2024-03-01T00:00:00.000Z');

INSERT INTO "assets" ("hash", "content_type", "file_ext", "byte_size", "r2_key", "created_at")
VALUES ('signed-hash', 'application/javascript', 'js', 512, 'assets/signed-hash', '2024-03-01T00:00:00.000Z');

INSERT INTO "update_assets" ("update_id", "asset_key", "asset_hash", "is_launch")
VALUES ('update-signed', 'bundle', 'signed-hash', 1);
`;

beforeAll(() => {
  writeFileSync(seedFile, seedSQL);
  execSync(`bunx wrangler d1 execute DB --local --persist-to ${persistDir} --file ${seedFile}`, {
    stdio: "pipe",
  });
});

afterAll(() => {
  rmSync(seedFile, { force: true });
});

// ── Helpers ─────────────────────────────────────────────────────

const manifestGet = (projectId: string, headers: Record<string, string>) =>
  fetch(`${getBaseUrl()}/manifest/${projectId}`, { headers });

const protocolHeaders = (overrides?: Record<string, string>) => ({
  "expo-protocol-version": "1",
  "expo-platform": "ios",
  "expo-runtime-version": "1.0.0",
  "expo-channel-name": "production",
  accept: "multipart/mixed",
  ...overrides,
});

interface MultipartPart {
  headers: Record<string, string>;
  body: string;
}

const parseMultipart = (contentType: string, rawBody: string): MultipartPart[] => {
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

// ── Manifest serving protocol tests ─────────────────────────────

describe("Manifest serving protocol", () => {
  it("returns a multipart manifest for a valid request", async () => {
    const response = await manifestGet("proj-1", protocolHeaders());
    expect(response.status).toBe(200);

    // Common protocol headers
    expect(response.headers.get("expo-protocol-version")).toBe("1");
    expect(response.headers.get("expo-sfv-version")).toBe("0");
    expect(response.headers.get("cache-control")).toBe("private, max-age=0");

    // Content type
    const contentType = response.headers.get("content-type")!;
    expect(contentType).toContain("multipart/mixed");
    expect(contentType).toContain("boundary=");

    // Parse multipart body
    const body = await response.text();
    const parts = parseMultipart(contentType, body);
    expect(parts).toHaveLength(2);

    // Manifest part
    const manifestPart = parts.find((part) =>
      part.headers["content-disposition"]?.includes('name="manifest"'),
    );
    expect(manifestPart).toBeDefined();
    const manifest = JSON.parse(manifestPart!.body);
    expect(manifest.id).toBe("update-ios");
    expect(manifest.runtimeVersion).toBe("1.0.0");
    expect(manifest.createdAt).toBe("2024-01-15T10:00:00.000Z");

    // Launch asset
    expect(manifest.launchAsset).toBeDefined();
    expect(manifest.launchAsset.hash).toBe("abc123hash");
    expect(manifest.launchAsset.key).toBe("bundle");
    expect(manifest.launchAsset.contentType).toBe("application/javascript");
    expect(manifest.launchAsset.url).toBe("https://assets.better-update.dev/assets/abc123hash");

    // Regular assets (non-launch)
    expect(manifest.assets).toHaveLength(1);
    expect(manifest.assets[0].hash).toBe("img456hash");
    expect(manifest.assets[0].key).toBe("logo.png");
    expect(manifest.assets[0].fileExtension).toBe(".png");
    expect(manifest.assets[0].url).toBe("https://assets.better-update.dev/assets/img456hash");

    // Extra with scopeKey
    expect(manifest.extra.scopeKey).toBe("@test/my-app");

    // Extensions part
    const extensionsPart = parts.find((part) =>
      part.headers["content-disposition"]?.includes('name="extensions"'),
    );
    expect(extensionsPart).toBeDefined();
    const extensions = JSON.parse(extensionsPart!.body);
    expect(extensions).toHaveProperty("assetRequestHeaders");
  });

  it("returns 204 when no update matches the runtime version", async () => {
    const response = await manifestGet(
      "proj-1",
      protocolHeaders({ "expo-runtime-version": "99.0.0" }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("expo-protocol-version")).toBe("1");
    expect(response.headers.get("expo-sfv-version")).toBe("0");
    expect(response.headers.get("cache-control")).toBe("private, max-age=0");
  });

  it("returns 204 when channel is paused", async () => {
    const response = await manifestGet(
      "proj-1",
      protocolHeaders({ "expo-channel-name": "staging" }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("expo-protocol-version")).toBe("1");
  });

  it("returns 400 when required headers are missing", async () => {
    const response = await manifestGet("proj-1", {});
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("BAD_REQUEST");
  });

  it("returns 400 for invalid platform", async () => {
    const response = await manifestGet("proj-1", protocolHeaders({ "expo-platform": "web" }));
    expect(response.status).toBe(400);
  });

  it("returns 404 for non-existent project", async () => {
    const response = await manifestGet("nonexistent", protocolHeaders());
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns 404 for non-existent channel", async () => {
    const response = await manifestGet(
      "proj-1",
      protocolHeaders({ "expo-channel-name": "nonexistent" }),
    );
    expect(response.status).toBe(404);
  });

  it("returns directive for rollback update", async () => {
    const response = await manifestGet(
      "proj-1",
      protocolHeaders({
        "expo-platform": "android",
        "expo-runtime-version": "1.0.0",
      }),
    );
    expect(response.status).toBe(200);

    const contentType = response.headers.get("content-type")!;
    const body = await response.text();
    const parts = parseMultipart(contentType, body);

    const directivePart = parts.find((part) =>
      part.headers["content-disposition"]?.includes('name="directive"'),
    );
    expect(directivePart).toBeDefined();
    const directive = JSON.parse(directivePart!.body);
    expect(directive.type).toBe("rollBackToEmbedded");
    expect(directive.parameters.commitTime).toBe("2024-01-16T10:00:00.000Z");
  });

  it("returns 406 when Accept header is unsupported", async () => {
    const response = await manifestGet("proj-1", protocolHeaders({ accept: "text/html" }));
    expect(response.status).toBe(406);
    const body = await response.json();
    expect(body.code).toBe("NOT_ACCEPTABLE");
  });

  it("returns flat JSON manifest for application/expo+json Accept", async () => {
    const response = await manifestGet(
      "proj-1",
      protocolHeaders({ accept: "application/expo+json" }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/expo+json");

    const manifest = await response.json();
    expect(manifest.id).toBe("update-ios");
    expect(manifest.runtimeVersion).toBe("1.0.0");
    expect(manifest.extra.scopeKey).toBe("@test/my-app");
  });

  it("returns pre-computed manifest_body as-is", async () => {
    const response = await manifestGet(
      "proj-1",
      protocolHeaders({ "expo-runtime-version": "2.0.0" }),
    );
    expect(response.status).toBe(200);

    const contentType = response.headers.get("content-type")!;
    const body = await response.text();
    const parts = parseMultipart(contentType, body);

    const manifestPart = parts.find((part) =>
      part.headers["content-disposition"]?.includes('name="manifest"'),
    );
    expect(manifestPart).toBeDefined();
    const manifest = JSON.parse(manifestPart!.body);
    expect(manifest.id).toBe("update-precomputed");
  });

  it("includes certificate_chain part in signed multipart response", async () => {
    const response = await manifestGet(
      "proj-1",
      protocolHeaders({
        "expo-runtime-version": "3.0.0",
        "expo-expect-signature": "true",
      }),
    );
    expect(response.status).toBe(200);

    const contentType = response.headers.get("content-type")!;
    const body = await response.text();
    const parts = parseMultipart(contentType, body);

    const certPart = parts.find((part) =>
      part.headers["content-disposition"]?.includes('name="certificate_chain"'),
    );
    expect(certPart).toBeDefined();
    expect(certPart!.headers["content-type"]).toBe("application/x-pem-file");
    expect(certPart!.body).toContain("BEGIN CERTIFICATE");

    const manifestPart = parts.find((part) =>
      part.headers["content-disposition"]?.includes('name="manifest"'),
    );
    expect(manifestPart).toBeDefined();
    expect(manifestPart!.headers["expo-signature"]).toBe("sig=test-signature");
  });

  it("includes protocol headers on all responses", async () => {
    // 204 response
    const noUpdate = await manifestGet(
      "proj-1",
      protocolHeaders({ "expo-runtime-version": "99.0.0" }),
    );
    expect(noUpdate.headers.get("expo-protocol-version")).toBe("1");
    expect(noUpdate.headers.get("expo-sfv-version")).toBe("0");
    expect(noUpdate.headers.get("cache-control")).toBe("private, max-age=0");

    // 400 response
    const badRequest = await manifestGet("proj-1", {});
    expect(badRequest.headers.get("expo-protocol-version")).toBe("1");
    expect(badRequest.headers.get("expo-sfv-version")).toBe("0");

    // 404 response
    const notFound = await manifestGet("nonexistent", protocolHeaders());
    expect(notFound.headers.get("expo-protocol-version")).toBe("1");
    expect(notFound.headers.get("expo-sfv-version")).toBe("0");
  });
});
