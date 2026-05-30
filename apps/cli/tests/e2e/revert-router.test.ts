import path from "node:path";

import { setupCliE2E } from "../helpers/cli-e2e";

const FIXTURE_DIR = path.resolve(import.meta.dirname, "../../../../fixtures/e2e-app");

const revertAppJsonTemplate = {
  expo: {
    name: "Revert Router App",
    slug: "revert-router-app",
    owner: "revert-router",
    version: "1.0.0",
    runtimeVersion: "1.0.0",
    ios: {
      bundleIdentifier: "com.example.revertrouter",
      buildNumber: "1",
    },
    android: {
      package: "com.example.revertrouter",
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

const cli = setupCliE2E("e2e-cli-revert", {
  projectDir: FIXTURE_DIR,
  appJsonTemplate: revertAppJsonTemplate,
  userEmail: "cli-e2e-revert@example.com",
  orgSlug: "cli-e2e-revert-org",
});

// ── Helpers ──────────────────────────────────────────────────────

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

const findPart = (parts: readonly MultipartPart[], name: string) =>
  parts.find((part) => part.headers["content-disposition"]?.includes(`name="${name}"`));

const manifestHeaders = (overrides?: Record<string, string>) => ({
  "expo-protocol-version": "1",
  "expo-platform": "ios",
  "expo-runtime-version": "1.0.0",
  "expo-channel-name": "main",
  accept: "multipart/mixed",
  ...overrides,
});

interface ServedManifest {
  readonly id: string;
  /** Last URL segment of `launchAsset.url` — the bundle content hash (stable per bytes). */
  readonly launchHash: string;
}

// Fetch the current manifest and pull out the update id + the launch bundle's
// content hash. `launchAsset.url` is `…/bundle/<updateId>/<launchHash>`, so the
// hash identifies the *content* independently of which update row serves it —
// exactly what distinguishes "republished previous content" from "a new export".
const fetchServedManifest = async (): Promise<ServedManifest> => {
  const response = await cli.get(`/manifest/${cli.getProjectId()}`, manifestHeaders());
  expect(response.status).toBe(200);
  const parts = parseMultipart(response.headers.get("content-type") ?? "", await response.text());
  const manifestPart = findPart(parts, "manifest");
  expect(manifestPart).toBeDefined();
  const manifest = JSON.parse(manifestPart!.body) as {
    id: string;
    launchAsset: { url: string };
  };
  return { id: manifest.id, launchHash: manifest.launchAsset.url.split("/").at(-1) ?? "" };
};

const publishGroupPattern = /Published update group ([0-9a-f-]+) to branch "main"\./;

const publishIos = (message?: string): string => {
  const result = cli.runCli(
    "update",
    "publish",
    "--branch",
    "main",
    "--platform",
    "ios",
    ...(message === undefined ? [] : ["--message", message]),
    "--allow-dirty",
  );
  expect(result.exitCode).toBe(0);
  const groupMatch = publishGroupPattern.exec(result.stdout);
  expect(groupMatch).toBeDefined();
  return groupMatch![1]!;
};

// ── Shared state across sequential tests ─────────────────────────

const state = {
  v1GroupId: "",
  v2GroupId: "",
  v1: { id: "", launchHash: "" } as ServedManifest,
  v2: { id: "", launchHash: "" } as ServedManifest,
};

// ── Tests ────────────────────────────────────────────────────────

describe("update revert router: --type published (republish previous) vs --type embedded", () => {
  it("links the fixture app to the seeded project", () => {
    const result = cli.runCli("init");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Project linked successfully");
  });

  it("publishes v1 then v2 with distinct bundle content", async () => {
    state.v1GroupId = publishIos();
    state.v1 = await fetchServedManifest();

    state.v2GroupId = publishIos("v2 update");
    state.v2 = await fetchServedManifest();

    // Two genuinely distinct updates: different rows AND different bundle bytes
    // (Hermes export is non-deterministic), so a later content match is meaningful.
    expect(state.v2GroupId).not.toBe(state.v1GroupId);
    expect(state.v2.id).not.toBe(state.v1.id);
    expect(state.v2.launchHash).not.toBe(state.v1.launchHash);
  });

  it("`--type published` republishes the *previous* group as a new live update", async () => {
    const result = cli.runCli(
      "update",
      "revert",
      "--branch",
      "main",
      "--platform",
      "ios",
      "--type",
      "published",
    );
    expect(result.exitCode).toBe(0);
    // The router targets v1's group (the one *before* the most-recent v2), not v2.
    expect(result.stdout).toContain(`Republishing previous group ${state.v1GroupId}`);
    expect(result.stdout).toContain("Republished 1 update(s).");

    const served = await fetchServedManifest();
    // A brand-new update row is now live…
    expect(served.id).not.toBe(state.v2.id);
    expect(served.id).not.toBe(state.v1.id);
    // …but it carries v1's exact bundle content, not v2's. That *is* the revert.
    expect(served.launchHash).toBe(state.v1.launchHash);
    expect(served.launchHash).not.toBe(state.v2.launchHash);
  });

  it("`--type embedded` publishes a rollback-to-embedded directive instead", async () => {
    const result = cli.runCli(
      "update",
      "revert",
      "--branch",
      "main",
      "--platform",
      "ios",
      "--type",
      "embedded",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Created rollback group");

    const response = await cli.get(`/manifest/${cli.getProjectId()}`, manifestHeaders());
    expect(response.status).toBe(200);
    const parts = parseMultipart(response.headers.get("content-type") ?? "", await response.text());

    const directivePart = findPart(parts, "directive");
    expect(directivePart).toBeDefined();
    const directive = JSON.parse(directivePart!.body) as {
      type: string;
      parameters: { commitTime: string };
    };
    expect(directive.type).toBe("rollBackToEmbedded");
    // Embedded revert was called without --commit-time, so the server stamps
    // "now" — assert a real ISO datetime value at runtime (not a type-level check).
    expect(directive.parameters.commitTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // A rollback directive is served alone — no manifest part rides with it.
    expect(findPart(parts, "manifest")).toBeUndefined();
  });

  it("refuses `--type published` on a branch with no previous group", async () => {
    // A real, resolvable branch that was never published to: the branch exists
    // (so name resolution succeeds) but has zero prior groups, so the router
    // must fail loudly and point the user at --type embedded.
    const created = await cli.postAuthorized("/api/branches", {
      projectId: cli.getProjectId(),
      name: "revert-empty",
    });
    expect(created.status).toBe(201);

    const result = cli.runCli(
      "update",
      "revert",
      "--branch",
      "revert-empty",
      "--platform",
      "ios",
      "--type",
      "published",
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr + result.stdout).toContain("does not have a previous update group");
  });
});
