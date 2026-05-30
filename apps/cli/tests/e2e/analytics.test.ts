import { setupCliE2E } from "../helpers/cli-e2e";

const analyticsAppJsonTemplate = {
  expo: {
    name: "Analytics App",
    slug: "analytics-app",
    owner: "analytics-cli",
    version: "1.0.0",
    runtimeVersion: "1.0.0",
    ios: {
      bundleIdentifier: "com.example.analyticscli",
      buildNumber: "1",
    },
    android: {
      package: "com.example.analyticscli",
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

const cli = setupCliE2E("e2e-cli-analytics", {
  appJsonTemplate: analyticsAppJsonTemplate,
  userEmail: "cli-e2e-analytics@example.com",
  orgSlug: "cli-e2e-analytics-org",
});

// ── Helpers ──────────────────────────────────────────────────────

interface SuccessEnvelope {
  readonly ok: boolean;
  readonly command: string;
  readonly data: any;
}

// `--json` makes stdout exactly one envelope line. Scan for it defensively in
// case the runner prepends a stray line.
const parseEnvelope = (stdout: string): SuccessEnvelope => {
  const line = stdout
    .split("\n")
    .map((raw) => raw.trim())
    .find((text) => text.startsWith("{") && text.includes('"schemaVersion"'));
  expect(line).toBeDefined();
  return JSON.parse(line!) as SuccessEnvelope;
};

// ── Tests ────────────────────────────────────────────────────────

describe("analytics: adoption / platforms / updates / channels (Analytics Engine empty path)", () => {
  // not-linked guard runs FIRST: the fresh temp app.json carries no projectId
  // until `init` writes it, so any analytics command resolves to
  // ProjectNotLinkedError → exit code 4. Human mode writes the message to
  // stderr; assert on stderr + stdout to stay mode-agnostic.
  it("GUARD: analytics before init errors with exit code 4 (project not linked)", () => {
    const result = cli.runCli("analytics", "adoption");
    expect(result.exitCode).toBe(4);
    const combined = result.stderr + result.stdout;
    expect(combined).toContain("Project not linked. Run");
    expect(combined).toContain("better-update init");
  });

  it("links the fixture app to the seeded project (init)", () => {
    const result = cli.runCli("init");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Project linked successfully");
  });

  it("analytics adoption --json returns a well-formed empty list envelope", () => {
    const result = cli.runCli("--json", "analytics", "adoption");
    expect(result.exitCode).toBe(0);
    const envelope = parseEnvelope(result.stdout);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe("analytics.adoption");
    const { items } = envelope.data;
    expect(Array.isArray(items)).toBe(true);
    expect(items as unknown[]).toHaveLength(0);
  });

  it("analytics adoption --period 7d --json still ok (period enum honored)", () => {
    const result = cli.runCli("--json", "analytics", "adoption", "--period", "7d");
    expect(result.exitCode).toBe(0);
    const envelope = parseEnvelope(result.stdout);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe("analytics.adoption");
    expect(Array.isArray(envelope.data.items)).toBe(true);
  });

  it("analytics platforms --json returns well-formed empty list", () => {
    const result = cli.runCli("--json", "analytics", "platforms");
    expect(result.exitCode).toBe(0);
    const envelope = parseEnvelope(result.stdout);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe("analytics.platforms");
    const { items } = envelope.data;
    expect(Array.isArray(items)).toBe(true);
    expect(items as unknown[]).toHaveLength(0);
  });

  it("analytics updates --json returns flat key/value metrics (zeros)", () => {
    const updateId = cli.getSeededBuildId();
    const result = cli.runCli("--json", "analytics", "updates", "--update-id", updateId);
    expect(result.exitCode).toBe(0);
    const envelope = parseEnvelope(result.stdout);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe("analytics.updates");
    const { data } = envelope;
    expect(data["Update ID"]).toBe(updateId);
    expect(data["Total Requests"]).toBe("0");
    expect(data["Unique Devices"]).toBe("0");
    expect(data["Manifest"]).toBe("0");
    expect(data["Directive"]).toBe("0");
    expect(data["No Update"]).toBe("0");
  });

  it("analytics channels --json returns flat key/value metrics (zeros)", () => {
    const result = cli.runCli("--json", "analytics", "channels", "--channel", "main");
    expect(result.exitCode).toBe(0);
    const envelope = parseEnvelope(result.stdout);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe("analytics.channels");
    const { data } = envelope;
    expect(data["Channel"]).toBe("main");
    expect(data["Total Requests"]).toBe("0");
    expect(data["Unique Devices"]).toBe("0");
    expect(data["Manifest"]).toBe("0");
    expect(data["Directive"]).toBe("0");
    expect(data["No Update"]).toBe("0");
  });

  it("analytics adoption human (non-json) prints empty message", () => {
    const result = cli.runCli("analytics", "adoption");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No adoption data found.");
  });

  it("analytics platforms human (non-json) prints empty message", () => {
    const result = cli.runCli("analytics", "platforms");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No platform data found.");
  });

  it("analytics channels human prints aligned key/value rows", () => {
    const result = cli.runCli("analytics", "channels", "--channel", "main");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Channel");
    expect(result.stdout).toContain("main");
    expect(result.stdout).toContain("Total Requests");
    expect(result.stdout).toContain("Unique Devices");
  });

  it("GUARD: missing required --channel errors (non-zero)", () => {
    const result = cli.runCli("--non-interactive", "analytics", "channels");
    expect(result.exitCode).not.toBe(0);
  });

  it("GUARD: missing required --update-id errors (non-zero)", () => {
    const result = cli.runCli("--non-interactive", "analytics", "updates");
    expect(result.exitCode).not.toBe(0);
  });
});
