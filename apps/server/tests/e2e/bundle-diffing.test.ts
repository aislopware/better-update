import { execSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";

import { setupE2EWorker } from "../helpers/e2e-worker";

const persistDir = ".wrangler/state/e2e-bundle-diffing";
const { getBaseUrl } = setupE2EWorker(persistDir);

// -- Seed data ----------------------------------------------------------------

const seedFile = ".wrangler/seed-bundle-diffing.sql";

const seedSQL = `
INSERT INTO "organization" ("id", "name", "slug", "created_at")
VALUES ('org-bd-1', 'Bundle Diff Org', 'bd-org', '2024-01-01');

INSERT INTO "projects" ("id", "organization_id", "name", "scope_key", "created_at")
VALUES ('proj-bd-1', 'org-bd-1', 'BD Project', '@test/bd-app', '2024-01-01T00:00:00.000Z');

INSERT INTO "branches" ("id", "project_id", "name", "created_at")
VALUES ('branch-bd-1', 'proj-bd-1', 'main', '2024-01-01T00:00:00.000Z');

INSERT INTO "channels" ("id", "project_id", "name", "branch_id", "is_paused", "created_at")
VALUES ('chan-bd-prod', 'proj-bd-1', 'production', 'branch-bd-1', 0, '2024-01-01T00:00:00.000Z');

-- Assets for update-1 (old) and update-2 (new)
INSERT INTO "assets" ("hash", "content_type", "file_ext", "byte_size", "r2_key", "created_at")
VALUES ('launch-hash-old', 'application/javascript', 'js', 2048, 'assets/launch-hash-old', '2024-01-10T00:00:00.000Z');

INSERT INTO "assets" ("hash", "content_type", "file_ext", "byte_size", "r2_key", "created_at")
VALUES ('launch-hash-new', 'application/javascript', 'js', 2200, 'assets/launch-hash-new', '2024-01-20T00:00:00.000Z');

INSERT INTO "assets" ("hash", "content_type", "file_ext", "byte_size", "r2_key", "created_at")
VALUES ('img-asset-1', 'image/png', 'png', 1024, 'assets/img-asset-1', '2024-01-10T00:00:00.000Z');

-- Update 1 (old): first update on this branch/platform/runtimeVersion
INSERT INTO "updates" ("id", "branch_id", "runtime_version", "platform", "message", "metadata_json", "group_id", "is_rollback", "created_at")
VALUES ('update-bd-1', 'branch-bd-1', '10.0.0', 'ios', 'first update', '{}', 'group-bd-1', 0, '2024-01-15T10:00:00.000Z');

INSERT INTO "update_assets" ("update_id", "asset_key", "asset_hash", "is_launch")
VALUES ('update-bd-1', 'bundle', 'launch-hash-old', 1);

INSERT INTO "update_assets" ("update_id", "asset_key", "asset_hash", "is_launch")
VALUES ('update-bd-1', 'logo.png', 'img-asset-1', 0);

-- Update 2 (new): second update, newer
INSERT INTO "updates" ("id", "branch_id", "runtime_version", "platform", "message", "metadata_json", "group_id", "is_rollback", "created_at")
VALUES ('update-bd-2', 'branch-bd-1', '10.0.0', 'ios', 'second update', '{}', 'group-bd-2', 0, '2024-01-20T10:00:00.000Z');

INSERT INTO "update_assets" ("update_id", "asset_key", "asset_hash", "is_launch")
VALUES ('update-bd-2', 'bundle', 'launch-hash-new', 1);

INSERT INTO "update_assets" ("update_id", "asset_key", "asset_hash", "is_launch")
VALUES ('update-bd-2', 'logo.png', 'img-asset-1', 0);

-- Update 3 + 4: on a different runtimeVersion, manifest resolution should still be normal
INSERT INTO "assets" ("hash", "content_type", "file_ext", "byte_size", "r2_key", "created_at")
VALUES ('launch-hash-v11-old', 'application/javascript', 'js', 1500, 'assets/launch-hash-v11-old', '2024-02-01T00:00:00.000Z');

INSERT INTO "assets" ("hash", "content_type", "file_ext", "byte_size", "r2_key", "created_at")
VALUES ('launch-hash-v11-new', 'application/javascript', 'js', 1800, 'assets/launch-hash-v11-new', '2024-02-10T00:00:00.000Z');

INSERT INTO "updates" ("id", "branch_id", "runtime_version", "platform", "message", "metadata_json", "group_id", "is_rollback", "created_at")
VALUES ('update-bd-v11-1', 'branch-bd-1', '11.0.0', 'ios', 'v11 first', '{}', 'group-bd-v11-1', 0, '2024-02-01T10:00:00.000Z');

INSERT INTO "update_assets" ("update_id", "asset_key", "asset_hash", "is_launch")
VALUES ('update-bd-v11-1', 'bundle', 'launch-hash-v11-old', 1);

INSERT INTO "updates" ("id", "branch_id", "runtime_version", "platform", "message", "metadata_json", "group_id", "is_rollback", "created_at")
VALUES ('update-bd-v11-2', 'branch-bd-1', '11.0.0', 'ios', 'v11 second', '{}', 'group-bd-v11-2', 0, '2024-02-10T10:00:00.000Z');

INSERT INTO "update_assets" ("update_id", "asset_key", "asset_hash", "is_launch")
VALUES ('update-bd-v11-2', 'bundle', 'launch-hash-v11-new', 1);
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

// -- Helpers ------------------------------------------------------------------

const manifestGet = (projectId: string, headers: Record<string, string>) =>
  fetch(`${getBaseUrl()}/manifest/${projectId}`, { headers });

const protocolHeaders = (overrides?: Record<string, string>) => ({
  "expo-protocol-version": "1",
  "expo-platform": "ios",
  "expo-runtime-version": "10.0.0",
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

const getExtensionsPart = async (response: Response) => {
  const contentType = response.headers.get("content-type")!;
  const body = await response.text();
  const parts = parseMultipart(contentType, body);
  const extensionsPart = parts.find((part) =>
    part.headers["content-disposition"]?.includes('name="extensions"'),
  );
  expect(extensionsPart).toBeDefined();
  return JSON.parse(extensionsPart!.body) as Record<string, unknown>;
};

// -- Tests: Manifest ignores patch hints --------------------------------------

describe("Manifest patch hints", () => {
  it("does NOT include patchedAssets when no expo-current-update-id header", async () => {
    const response = await manifestGet("proj-bd-1", protocolHeaders());
    expect(response.status).toBe(200);

    const extensions = await getExtensionsPart(response);
    expect(extensions).toHaveProperty("assetRequestHeaders");
    expect(extensions).not.toHaveProperty("patchedAssets");
  });

  it("ignores expo-current-update-id when resolving from an older update", async () => {
    const response = await manifestGet(
      "proj-bd-1",
      protocolHeaders({ "expo-current-update-id": "update-bd-1" }),
    );
    expect(response.status).toBe(200);

    const extensions = await getExtensionsPart(response);
    expect(extensions).toHaveProperty("assetRequestHeaders");
    expect(extensions).not.toHaveProperty("patchedAssets");
  });

  it("serves normal manifest without patchedAssets when no patch exists", async () => {
    // v11 has two updates but no patch row
    const response = await manifestGet(
      "proj-bd-1",
      protocolHeaders({
        "expo-runtime-version": "11.0.0",
        "expo-current-update-id": "update-bd-v11-1",
      }),
    );
    expect(response.status).toBe(200);

    const extensions = await getExtensionsPart(response);
    expect(extensions).toHaveProperty("assetRequestHeaders");
    expect(extensions).not.toHaveProperty("patchedAssets");
  });

  it("returns 204 when the client is already on the latest update", async () => {
    const response = await manifestGet(
      "proj-bd-1",
      protocolHeaders({ "expo-current-update-id": "update-bd-2" }),
    );
    expect(response.status).toBe(204);
  });
});
