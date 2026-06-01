import { setupE2EWorker } from "../helpers/e2e-worker-pool";
import { seedD1 } from "../helpers/seed-d1";

const { get } = setupE2EWorker();

// ── Seed data via raw SQL (independent of management API) ───────

const seedSQL = `
INSERT INTO "organization" ("id", "name", "slug", "created_at")
VALUES ('org-1', 'Manifest Test Org', 'manifest-test-org', '2024-01-01');

INSERT INTO "projects" ("id", "organization_id", "name", "slug", "created_at")
VALUES ('proj-1', 'org-1', 'Test Project', 'my-app', '2024-01-01T00:00:00.000Z');

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

INSERT INTO "assets" ("hash", "content_type", "file_ext", "byte_size", "r2_key", "content_checksum", "created_at")
VALUES ('abc123hash', 'application/javascript', 'js', 1024, 'assets/abc123hash', 'abc123hash', '2024-01-15T00:00:00.000Z');

INSERT INTO "assets" ("hash", "content_type", "file_ext", "byte_size", "r2_key", "content_checksum", "created_at")
VALUES ('img456hash', 'image/png', 'png', 2048, 'assets/img456hash', 'img456hash', '2024-01-15T00:00:00.000Z');

INSERT INTO "update_assets" ("update_id", "asset_key", "asset_hash", "is_launch")
VALUES ('update-ios', 'bundle', 'abc123hash', 1);

INSERT INTO "update_assets" ("update_id", "asset_key", "asset_hash", "is_launch")
VALUES ('update-ios', 'logo.png', 'img456hash', 0);

INSERT INTO "updates" ("id", "branch_id", "runtime_version", "platform", "message", "metadata_json", "group_id", "is_rollback", "manifest_body", "created_at")
VALUES ('update-precomputed', 'branch-1', '2.0.0', 'ios', 'precomputed', '{}', 'group-3', 0, '{"id":"update-precomputed","createdAt":"2024-02-01T00:00:00.000Z","runtimeVersion":"2.0.0","launchAsset":null,"assets":[],"metadata":{},"extra":{}}', '2024-02-01T00:00:00.000Z');

INSERT INTO "updates" ("id", "branch_id", "runtime_version", "platform", "message", "metadata_json", "group_id", "is_rollback", "signature", "certificate_chain", "created_at")
VALUES ('update-signed', 'branch-1', '3.0.0', 'ios', 'signed update', '{}', 'group-4', 0, 'sig=test-signature', '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----', '2024-03-01T00:00:00.000Z');

INSERT INTO "assets" ("hash", "content_type", "file_ext", "byte_size", "r2_key", "content_checksum", "created_at")
VALUES ('signed-hash', 'application/javascript', 'js', 512, 'assets/signed-hash', 'signed-hash', '2024-03-01T00:00:00.000Z');

INSERT INTO "update_assets" ("update_id", "asset_key", "asset_hash", "is_launch")
VALUES ('update-signed', 'bundle', 'signed-hash', 1);

-- Rollout test data: two branches, channel with branch_mapping_json
INSERT INTO "branches" ("id", "project_id", "name", "created_at")
VALUES ('branch-rollout-old', 'proj-1', 'rollout-old', '2024-04-01T00:00:00.000Z');

INSERT INTO "branches" ("id", "project_id", "name", "created_at")
VALUES ('branch-rollout-new', 'proj-1', 'rollout-new', '2024-04-01T00:00:00.000Z');

INSERT INTO "channels" ("id", "project_id", "name", "branch_id", "branch_mapping_json", "is_paused", "created_at")
VALUES ('chan-rollout', 'proj-1', 'rollout', 'branch-rollout-old', '{"data":[{"branchId":"branch-rollout-new","branchMappingLogic":"hash_lt(mappingId, 0.50)"},{"branchId":"branch-rollout-old","branchMappingLogic":"true"}],"salt":"test-salt"}', 0, '2024-04-01T00:00:00.000Z');

INSERT INTO "channels" ("id", "project_id", "name", "branch_id", "is_paused", "created_at")
VALUES ('chan-no-rollout', 'proj-1', 'no-rollout', 'branch-rollout-old', 0, '2024-04-01T00:00:00.000Z');

INSERT INTO "updates" ("id", "branch_id", "runtime_version", "platform", "message", "metadata_json", "group_id", "is_rollback", "manifest_body", "created_at")
VALUES ('update-rollout-old', 'branch-rollout-old', '5.0.0', 'ios', 'old branch update', '{}', 'group-ro-1', 0, '{"id":"update-rollout-old","createdAt":"2024-04-01T00:00:00.000Z","runtimeVersion":"5.0.0","launchAsset":null,"assets":[],"metadata":{},"extra":{}}', '2024-04-01T00:00:00.000Z');

INSERT INTO "updates" ("id", "branch_id", "runtime_version", "platform", "message", "metadata_json", "group_id", "is_rollback", "manifest_body", "created_at")
VALUES ('update-rollout-new', 'branch-rollout-new', '5.0.0', 'ios', 'new branch update', '{}', 'group-ro-2', 0, '{"id":"update-rollout-new","createdAt":"2024-04-02T00:00:00.000Z","runtimeVersion":"5.0.0","launchAsset":null,"assets":[],"metadata":{},"extra":{}}', '2024-04-02T00:00:00.000Z');

-- Per-update rollout test data
INSERT INTO "branches" ("id", "project_id", "name", "created_at")
VALUES ('branch-update-rollout', 'proj-1', 'update-rollout', '2024-05-01T00:00:00.000Z');

INSERT INTO "channels" ("id", "project_id", "name", "branch_id", "is_paused", "created_at")
VALUES ('chan-update-rollout', 'proj-1', 'update-rollout', 'branch-update-rollout', 0, '2024-05-01T00:00:00.000Z');

-- Previous update: fully rolled out (100%)
INSERT INTO "updates" ("id", "branch_id", "runtime_version", "platform", "message", "metadata_json", "group_id", "rollout_percentage", "is_rollback", "manifest_body", "created_at")
VALUES ('update-ur-prev', 'branch-update-rollout', '6.0.0', 'ios', 'previous stable', '{}', 'group-ur-1', 100, 0, '{"id":"update-ur-prev","createdAt":"2024-05-01T00:00:00.000Z","runtimeVersion":"6.0.0","launchAsset":null,"assets":[],"metadata":{},"extra":{}}', '2024-05-01T00:00:00.000Z');

-- Latest update: partial rollout at 50%
INSERT INTO "updates" ("id", "branch_id", "runtime_version", "platform", "message", "metadata_json", "group_id", "rollout_percentage", "is_rollback", "manifest_body", "created_at")
VALUES ('update-ur-latest', 'branch-update-rollout', '6.0.0', 'ios', 'canary release', '{}', 'group-ur-2', 50, 0, '{"id":"update-ur-latest","createdAt":"2024-05-02T00:00:00.000Z","runtimeVersion":"6.0.0","launchAsset":null,"assets":[],"metadata":{},"extra":{}}', '2024-05-02T00:00:00.000Z');

-- Reverted update test data (separate runtimeVersion)
INSERT INTO "updates" ("id", "branch_id", "runtime_version", "platform", "message", "metadata_json", "group_id", "rollout_percentage", "is_rollback", "manifest_body", "created_at")
VALUES ('update-ur-reverted-prev', 'branch-update-rollout', '7.0.0', 'ios', 'old stable', '{}', 'group-ur-3', 100, 0, '{"id":"update-ur-reverted-prev","createdAt":"2024-05-03T00:00:00.000Z","runtimeVersion":"7.0.0","launchAsset":null,"assets":[],"metadata":{},"extra":{}}', '2024-05-03T00:00:00.000Z');

INSERT INTO "updates" ("id", "branch_id", "runtime_version", "platform", "message", "metadata_json", "group_id", "rollout_percentage", "is_rollback", "manifest_body", "created_at")
VALUES ('update-ur-reverted', 'branch-update-rollout', '7.0.0', 'ios', 'reverted release', '{}', 'group-ur-4', 0, 0, '{"id":"update-ur-reverted","createdAt":"2024-05-04T00:00:00.000Z","runtimeVersion":"7.0.0","launchAsset":null,"assets":[],"metadata":{},"extra":{}}', '2024-05-04T00:00:00.000Z');

-- Cache invalidation test data (runtime 8.0.0)
INSERT INTO "updates" ("id", "branch_id", "runtime_version", "platform", "message", "metadata_json", "group_id", "is_rollback", "manifest_body", "created_at")
VALUES ('update-cache-v1', 'branch-1', '8.0.0', 'ios', 'cache test v1', '{}', 'group-cache-1', 0, '{"id":"update-cache-v1","createdAt":"2024-06-01T00:00:00.000Z","runtimeVersion":"8.0.0","launchAsset":null,"assets":[],"metadata":{},"extra":{}}', '2024-06-01T00:00:00.000Z');

-- Gradual rollback test data (runtime 9.0.0): stable update at 100%, then a
-- rollback directive published at 50%. The rollback is the latest candidate, so
-- the per-update rollout bucketing (salt = "update-grollback-rb") decides who
-- rolls back: in-rollout clients get the directive, the rest stay on the manifest.
INSERT INTO "branches" ("id", "project_id", "name", "created_at")
VALUES ('branch-grollback', 'proj-1', 'grollback', '2024-08-01T00:00:00.000Z');

INSERT INTO "channels" ("id", "project_id", "name", "branch_id", "is_paused", "created_at")
VALUES ('chan-grollback', 'proj-1', 'grollback', 'branch-grollback', 0, '2024-08-01T00:00:00.000Z');

INSERT INTO "updates" ("id", "branch_id", "runtime_version", "platform", "message", "metadata_json", "group_id", "rollout_percentage", "is_rollback", "manifest_body", "created_at")
VALUES ('update-grollback-prev', 'branch-grollback', '9.0.0', 'ios', 'stable before rollback', '{}', 'group-gr-1', 100, 0, '{"id":"update-grollback-prev","createdAt":"2024-08-01T00:00:00.000Z","runtimeVersion":"9.0.0","launchAsset":null,"assets":[],"metadata":{},"extra":{}}', '2024-08-01T00:00:00.000Z');

INSERT INTO "updates" ("id", "branch_id", "runtime_version", "platform", "message", "metadata_json", "group_id", "rollout_percentage", "is_rollback", "created_at")
VALUES ('update-grollback-rb', 'branch-grollback', '9.0.0', 'ios', 'gradual rollback', '{}', 'group-gr-2', 50, 1, '2024-08-02T00:00:00.000Z');

-- Fallback-to-fully-rolled-out test data (3+ update chain). resolveUpdates uses
-- LIMIT 2, so when the two newest candidates are not servable the handler must
-- run resolveFullyRolledOutUpdate to reach an older 100% update.
INSERT INTO "branches" ("id", "project_id", "name", "created_at")
VALUES ('branch-fbchain', 'proj-1', 'fbchain', '2024-09-01T00:00:00.000Z');

INSERT INTO "channels" ("id", "project_id", "name", "branch_id", "is_paused", "created_at")
VALUES ('chan-fbchain', 'proj-1', 'fbchain', 'branch-fbchain', 0, '2024-09-01T00:00:00.000Z');

-- Runtime 10.0.0: the two newest are both reverted (0%), the oldest is 100%.
INSERT INTO "updates" ("id", "branch_id", "runtime_version", "platform", "message", "metadata_json", "group_id", "rollout_percentage", "is_rollback", "manifest_body", "created_at")
VALUES ('update-fb-c-old', 'branch-fbchain', '10.0.0', 'ios', 'oldest stable', '{}', 'group-fbc-1', 100, 0, '{"id":"update-fb-c-old","createdAt":"2024-09-01T00:00:00.000Z","runtimeVersion":"10.0.0","launchAsset":null,"assets":[],"metadata":{},"extra":{}}', '2024-09-01T00:00:00.000Z');

INSERT INTO "updates" ("id", "branch_id", "runtime_version", "platform", "message", "metadata_json", "group_id", "rollout_percentage", "is_rollback", "manifest_body", "created_at")
VALUES ('update-fb-c-mid', 'branch-fbchain', '10.0.0', 'ios', 'reverted middle', '{}', 'group-fbc-2', 0, 0, '{"id":"update-fb-c-mid","createdAt":"2024-09-02T00:00:00.000Z","runtimeVersion":"10.0.0","launchAsset":null,"assets":[],"metadata":{},"extra":{}}', '2024-09-02T00:00:00.000Z');

INSERT INTO "updates" ("id", "branch_id", "runtime_version", "platform", "message", "metadata_json", "group_id", "rollout_percentage", "is_rollback", "manifest_body", "created_at")
VALUES ('update-fb-c-latest', 'branch-fbchain', '10.0.0', 'ios', 'reverted latest', '{}', 'group-fbc-3', 0, 0, '{"id":"update-fb-c-latest","createdAt":"2024-09-03T00:00:00.000Z","runtimeVersion":"10.0.0","launchAsset":null,"assets":[],"metadata":{},"extra":{}}', '2024-09-03T00:00:00.000Z');

-- Runtime 11.0.0: newest is a 50% rollout, middle reverted (0%), oldest 100%.
-- Salt = "update-fb-d-latest": "client-a" ~0.79 (out) skips to oldest, "client-b" ~0.14 (in) keeps latest.
INSERT INTO "updates" ("id", "branch_id", "runtime_version", "platform", "message", "metadata_json", "group_id", "rollout_percentage", "is_rollback", "manifest_body", "created_at")
VALUES ('update-fb-d-old', 'branch-fbchain', '11.0.0', 'ios', 'oldest stable', '{}', 'group-fbd-1', 100, 0, '{"id":"update-fb-d-old","createdAt":"2024-09-04T00:00:00.000Z","runtimeVersion":"11.0.0","launchAsset":null,"assets":[],"metadata":{},"extra":{}}', '2024-09-04T00:00:00.000Z');

INSERT INTO "updates" ("id", "branch_id", "runtime_version", "platform", "message", "metadata_json", "group_id", "rollout_percentage", "is_rollback", "manifest_body", "created_at")
VALUES ('update-fb-d-mid', 'branch-fbchain', '11.0.0', 'ios', 'reverted middle', '{}', 'group-fbd-2', 0, 0, '{"id":"update-fb-d-mid","createdAt":"2024-09-05T00:00:00.000Z","runtimeVersion":"11.0.0","launchAsset":null,"assets":[],"metadata":{},"extra":{}}', '2024-09-05T00:00:00.000Z');

INSERT INTO "updates" ("id", "branch_id", "runtime_version", "platform", "message", "metadata_json", "group_id", "rollout_percentage", "is_rollback", "manifest_body", "created_at")
VALUES ('update-fb-d-latest', 'branch-fbchain', '11.0.0', 'ios', 'canary', '{}', 'group-fbd-3', 50, 0, '{"id":"update-fb-d-latest","createdAt":"2024-09-06T00:00:00.000Z","runtimeVersion":"11.0.0","launchAsset":null,"assets":[],"metadata":{},"extra":{}}', '2024-09-06T00:00:00.000Z');
`;

beforeAll(async () => {
  await seedD1(seedSQL);
});

// ── Helpers ─────────────────────────────────────────────────────

const manifestGet = (projectId: string, headers: Record<string, string>) =>
  get(`/manifest/${projectId}`, headers);

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

const expectManifestId = async (response: Response, expectedId: string) => {
  const contentType = response.headers.get("content-type")!;
  const body = await response.text();
  const parts = parseMultipart(contentType, body);
  const manifestPart = parts.find((part) =>
    part.headers["content-disposition"]?.includes('name="manifest"'),
  );
  expect(manifestPart).toBeDefined();
  const manifest = JSON.parse(manifestPart!.body);
  expect(manifest.id).toBe(expectedId);
};

const expectRollbackDirective = async (response: Response, expectedCommitTime: string) => {
  const contentType = response.headers.get("content-type")!;
  const body = await response.text();
  const parts = parseMultipart(contentType, body);
  const directivePart = parts.find((part) =>
    part.headers["content-disposition"]?.includes('name="directive"'),
  );
  expect(directivePart).toBeDefined();
  const directive = JSON.parse(directivePart!.body);
  expect(directive.type).toBe("rollBackToEmbedded");
  expect(directive.parameters.commitTime).toBe(expectedCommitTime);
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

    // Launch asset — the launch URL points at the Worker bundle route (not the
    // CDN) so the Worker negotiates bsdiff patches (Gap-D); regular assets stay
    // on the CDN.
    expect(manifest.launchAsset).toBeDefined();
    expect(manifest.launchAsset.hash).toBe("abc123hash");
    expect(manifest.launchAsset.key).toBe("bundle");
    expect(manifest.launchAsset.contentType).toBe("application/javascript");
    expect(manifest.launchAsset.url).toBe(
      `${process.env["PUBLIC_API_URL"]}/manifest/proj-1/bundle/update-ios/abc123hash`,
    );

    // Regular assets (non-launch)
    expect(manifest.assets).toHaveLength(1);
    expect(manifest.assets[0].hash).toBe("img456hash");
    expect(manifest.assets[0].key).toBe("logo.png");
    expect(manifest.assets[0].fileExtension).toBe(".png");
    expect(manifest.assets[0].url).toBe(`${process.env["ASSET_CDN_URL"]}/assets/img456hash`);

    // Server serves extra verbatim and NEVER injects scopeKey itself — extra.scopeKey
    // is added by the CLI at publish time. This test publishes via the API with a
    // scopeKey-less extra, so none appears here.
    expect(manifest.extra).not.toHaveProperty("scopeKey");

    // expo-manifest-filters header is NOT emitted (no dead filter)
    expect(response.headers.get("expo-manifest-filters")).toBeNull();

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
    // Server serves extra verbatim and never injects scopeKey itself (the CLI does,
    // at publish time); this update was created via the API with no scopeKey.
    expect(manifest.extra).not.toHaveProperty("scopeKey");
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

// ── Branch mapping / rollout resolution tests ──────────────────

const rolloutHeaders = (overrides?: Record<string, string>) =>
  protocolHeaders({
    "expo-runtime-version": "5.0.0",
    "expo-channel-name": "rollout",
    ...overrides,
  });

describe("Rollout manifest resolution", () => {
  // With salt "test-salt":
  // - "client-above-threshold" hashes to ~0.471 (below 0.50 -> gets NEW branch)
  // - "client-below-threshold" hashes to ~0.777 (above 0.50 -> gets OLD branch)

  it("serves new branch update for client in rollout group", async () => {
    const response = await manifestGet(
      "proj-1",
      rolloutHeaders({
        "eas-client-id": "client-above-threshold",
      }),
    );
    expect(response.status).toBe(200);
    await expectManifestId(response, "update-rollout-new");
  });

  it("serves old branch update for client NOT in rollout group", async () => {
    const response = await manifestGet(
      "proj-1",
      rolloutHeaders({
        "eas-client-id": "client-below-threshold",
      }),
    );
    expect(response.status).toBe(200);
    await expectManifestId(response, "update-rollout-old");
  });

  it("serves fallback (old) branch update when no EAS-Client-ID header", async () => {
    const response = await manifestGet("proj-1", rolloutHeaders());
    expect(response.status).toBe(200);
    await expectManifestId(response, "update-rollout-old");
  });

  it("resolves normally when no rollout is active (branch_mapping_json is NULL)", async () => {
    const response = await manifestGet(
      "proj-1",
      protocolHeaders({
        "expo-runtime-version": "5.0.0",
        "expo-channel-name": "no-rollout",
        "eas-client-id": "any-client-id",
      }),
    );
    expect(response.status).toBe(200);
    await expectManifestId(response, "update-rollout-old");
  });
});

// ── Manifest caching tests ────────────────────────────────────────

describe("Manifest caching", () => {
  it("second request returns same manifest", async () => {
    const headers = protocolHeaders({ "expo-runtime-version": "2.0.0" });

    const first = await manifestGet("proj-1", headers);
    expect(first.status).toBe(200);
    await expectManifestId(first, "update-precomputed");

    const second = await manifestGet("proj-1", headers);
    expect(second.status).toBe(200);
    await expectManifestId(second, "update-precomputed");
  });

  it("cache-control is always private", async () => {
    const response = await manifestGet(
      "proj-1",
      protocolHeaders({ "expo-runtime-version": "2.0.0" }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, max-age=0");
  });

  it("does not leak internal cache headers", async () => {
    const response = await manifestGet(
      "proj-1",
      protocolHeaders({ "expo-runtime-version": "2.0.0" }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-cache-update-id")).toBeNull();
    expect(response.headers.get("x-cache-response-type")).toBeNull();
  });

  it("does not cache partial rollout responses (cache poisoning prevention)", async () => {
    // Two clients hitting the same per-update rollout channel should get different updates
    // because the 50% rollout is non-deterministic per client ID.
    // If the first response were cached, the second client would incorrectly get the same.
    const inRollout = await manifestGet(
      "proj-1",
      protocolHeaders({
        "expo-runtime-version": "6.0.0",
        "expo-channel-name": "update-rollout",
        "eas-client-id": "client-in-rollout",
      }),
    );
    await expectManifestId(inRollout, "update-ur-latest");

    const outRollout = await manifestGet(
      "proj-1",
      protocolHeaders({
        "expo-runtime-version": "6.0.0",
        "expo-channel-name": "update-rollout",
        "eas-client-id": "client-out-rollout",
      }),
    );
    await expectManifestId(outRollout, "update-ur-prev");
  });

  it("signed and unsigned requests produce separate cache entries", async () => {
    // Request without signature
    const unsigned = await manifestGet(
      "proj-1",
      protocolHeaders({ "expo-runtime-version": "3.0.0" }),
    );
    expect(unsigned.status).toBe(200);
    const unsignedBody = await unsigned.text();
    const unsignedParts = parseMultipart(unsigned.headers.get("content-type")!, unsignedBody);
    const unsignedManifest = unsignedParts.find((p) =>
      p.headers["content-disposition"]?.includes('name="manifest"'),
    );
    expect(unsignedManifest).toBeDefined();
    // Unsigned response should NOT have expo-signature on the manifest part
    expect(unsignedManifest!.headers["expo-signature"]).toBeUndefined();
    // Unsigned response should NOT have certificate_chain part
    const unsignedCert = unsignedParts.find((p) =>
      p.headers["content-disposition"]?.includes('name="certificate_chain"'),
    );
    expect(unsignedCert).toBeUndefined();

    // Request with signature
    const signed = await manifestGet(
      "proj-1",
      protocolHeaders({
        "expo-runtime-version": "3.0.0",
        "expo-expect-signature": "true",
      }),
    );
    expect(signed.status).toBe(200);
    const signedBody = await signed.text();
    const signedParts = parseMultipart(signed.headers.get("content-type")!, signedBody);
    const signedManifest = signedParts.find((p) =>
      p.headers["content-disposition"]?.includes('name="manifest"'),
    );
    expect(signedManifest).toBeDefined();
    // Signed response MUST have expo-signature on the manifest part
    expect(signedManifest!.headers["expo-signature"]).toBe("sig=test-signature");
    // Signed response MUST have certificate_chain part
    const signedCert = signedParts.find((p) =>
      p.headers["content-disposition"]?.includes('name="certificate_chain"'),
    );
    expect(signedCert).toBeDefined();
    expect(signedCert!.body).toContain("BEGIN CERTIFICATE");
  });

  it("serves fresh data after cache_version bump", async () => {
    const headers = protocolHeaders({ "expo-runtime-version": "8.0.0" });

    // Warm cache with update-cache-v1
    const first = await manifestGet("proj-1", headers);
    await expectManifestId(first, "update-cache-v1");

    // Insert a newer update and bump cache_version (simulates a publish)
    await seedD1(
      `INSERT INTO "updates" ("id", "branch_id", "runtime_version", "platform", "message", "metadata_json", "group_id", "is_rollback", "manifest_body", "created_at")
VALUES ('update-cache-v2', 'branch-1', '8.0.0', 'ios', 'cache test v2', '{}', 'group-cache-2', 0, '{"id":"update-cache-v2","createdAt":"2024-07-01T00:00:00.000Z","runtimeVersion":"8.0.0","launchAsset":null,"assets":[],"metadata":{},"extra":{}}', '2024-07-01T00:00:00.000Z');
UPDATE "channels" SET "cache_version" = "cache_version" + 1 WHERE "id" = 'chan-prod';`,
    );

    // Second request should get the new update (cache key changed due to bumped version)
    const second = await manifestGet("proj-1", headers);
    await expectManifestId(second, "update-cache-v2");
  });
});

// ── Per-update rollout resolution tests ──────────────────────────

const updateRolloutHeaders = (overrides?: Record<string, string>) =>
  protocolHeaders({
    "expo-runtime-version": "6.0.0",
    "expo-channel-name": "update-rollout",
    ...overrides,
  });

describe("Per-update rollout manifest resolution", () => {
  // With salt "update-ur-latest" (the update ID):
  // - "client-in-rollout" hashes to ~0.236 (below 0.50 → gets LATEST update)
  // - "client-out-rollout" hashes to ~0.577 (above 0.50 → gets PREVIOUS update)

  it("serves latest update for device in rollout group", async () => {
    const response = await manifestGet(
      "proj-1",
      updateRolloutHeaders({ "eas-client-id": "client-in-rollout" }),
    );
    expect(response.status).toBe(200);
    await expectManifestId(response, "update-ur-latest");
  });

  it("serves previous update for device NOT in rollout group", async () => {
    const response = await manifestGet(
      "proj-1",
      updateRolloutHeaders({ "eas-client-id": "client-out-rollout" }),
    );
    expect(response.status).toBe(200);
    await expectManifestId(response, "update-ur-prev");
  });

  it("falls back to previous update when no EAS-Client-ID header", async () => {
    const response = await manifestGet("proj-1", updateRolloutHeaders());
    expect(response.status).toBe(200);
    await expectManifestId(response, "update-ur-prev");
  });

  it("skips reverted update and serves previous", async () => {
    // runtimeVersion 7.0.0: latest is reverted (0%), previous is 100%
    const response = await manifestGet(
      "proj-1",
      updateRolloutHeaders({
        "expo-runtime-version": "7.0.0",
        "eas-client-id": "any-client",
      }),
    );
    expect(response.status).toBe(200);
    await expectManifestId(response, "update-ur-reverted-prev");
  });
});

// ── Gradual rollback (rollback directive under partial rollout) ──

const grollbackHeaders = (overrides?: Record<string, string>) =>
  protocolHeaders({
    "expo-runtime-version": "9.0.0",
    "expo-channel-name": "grollback",
    ...overrides,
  });

describe("Gradual rollback manifest resolution", () => {
  // Latest update is a rollback directive at 50%. With salt "update-grollback-rb":
  // - "client-c" hashes to ~0.165 (below 0.50 → inside the rollback rollout)
  // - "client-a" hashes to ~0.667 (above 0.50 → outside, stays on the stable build)

  it("serves the rollback directive to a device inside the rollback rollout", async () => {
    const response = await manifestGet("proj-1", grollbackHeaders({ "eas-client-id": "client-c" }));
    expect(response.status).toBe(200);
    await expectRollbackDirective(response, "2024-08-02T00:00:00.000Z");
  });

  it("serves the previous stable manifest to a device outside the rollback rollout", async () => {
    const response = await manifestGet("proj-1", grollbackHeaders({ "eas-client-id": "client-a" }));
    expect(response.status).toBe(200);
    await expectManifestId(response, "update-grollback-prev");
  });

  it("falls back to the previous stable manifest when no EAS-Client-ID is sent", async () => {
    const response = await manifestGet("proj-1", grollbackHeaders());
    expect(response.status).toBe(200);
    await expectManifestId(response, "update-grollback-prev");
  });
});

// ── Fallback to a fully-rolled-out update past the LIMIT-2 window ──

const fallbackChainHeaders = (overrides?: Record<string, string>) =>
  protocolHeaders({
    "expo-channel-name": "fbchain",
    ...overrides,
  });

describe("Fallback to fully-rolled-out update (3+ update chain)", () => {
  it("serves the oldest 100% update when the two newest candidates are both reverted", async () => {
    // Runtime 10.0.0: latest 0%, middle 0% (both returned by LIMIT 2), oldest 100%.
    const response = await manifestGet(
      "proj-1",
      fallbackChainHeaders({ "expo-runtime-version": "10.0.0", "eas-client-id": "any-client" }),
    );
    expect(response.status).toBe(200);
    await expectManifestId(response, "update-fb-c-old");
  });

  it("skips a partial-rollout latest (client outside) and a reverted middle to the oldest 100%", async () => {
    // Runtime 11.0.0: latest 50% with "client-a" outside (~0.79), middle 0%, oldest 100%.
    const response = await manifestGet(
      "proj-1",
      fallbackChainHeaders({ "expo-runtime-version": "11.0.0", "eas-client-id": "client-a" }),
    );
    expect(response.status).toBe(200);
    await expectManifestId(response, "update-fb-d-old");
  });

  it("still serves the partial-rollout latest to a client inside the rollout", async () => {
    // Runtime 11.0.0: latest 50% with "client-b" inside (~0.14) → no fallback needed.
    const response = await manifestGet(
      "proj-1",
      fallbackChainHeaders({ "expo-runtime-version": "11.0.0", "eas-client-id": "client-b" }),
    );
    expect(response.status).toBe(200);
    await expectManifestId(response, "update-fb-d-latest");
  });
});
