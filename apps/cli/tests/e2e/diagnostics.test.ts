import { setupCliE2E } from "../helpers/cli-e2e";

const diagnosticsAppJsonTemplate = {
  expo: {
    name: "Diagnostics App",
    slug: "cli-e2e-diagnostics-app",
    owner: "cli-e2e-diagnostics",
    version: "1.0.0",
    runtimeVersion: "1.0.0",
    ios: {
      bundleIdentifier: "com.example.diagnostics",
      buildNumber: "1",
    },
    android: {
      package: "com.example.diagnostics",
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

const cli = setupCliE2E("e2e-cli-diagnostics", {
  appJsonTemplate: diagnosticsAppJsonTemplate,
  userEmail: "cli-e2e-diagnostics@example.com",
  orgSlug: "cli-e2e-diagnostics-org",
});

// ── Helpers ──────────────────────────────────────────────────────

interface Envelope {
  readonly ok: boolean;
  readonly command: string;
  readonly data: Record<string, unknown>;
}

// `--json` makes stdout exactly one envelope line (human chrome is suppressed
// entirely in JSON mode). Scan for it defensively in case the runner prepends a
// stray line.
const parseEnvelope = (stdout: string): Envelope => {
  const line = stdout
    .split("\n")
    .map((raw) => raw.trim())
    .find((text) => text.startsWith("{") && text.includes('"schemaVersion"'));
  expect(line).toBeDefined();
  return JSON.parse(line!) as Envelope;
};

// ── Tests ────────────────────────────────────────────────────────

describe("diagnostics: whoami / doctor / logout / projects list / audit-logs list", () => {
  // ORDERING IS LOAD-BEARING: this guard MUST run before `init`. `init` writes
  // `projectId` into app.json, after which `status` would succeed instead of
  // failing the not-linked guard.
  it("status without init fails with the project-not-linked guard (exit 4)", () => {
    const result = cli.runCli("status");
    expect(result.exitCode).toBe(4);
  });

  it("whoami (human) shows the api-key actor + active organization", () => {
    const result = cli.runCli("whoami");
    expect(result.exitCode).toBe(0);
    // api-key auth → user is null, so the "Actor" branch renders (NOT User ID /
    // Name / Email), with both Actor and Source values "api-key".
    expect(result.stdout).toContain("Actor");
    expect(result.stdout).toContain("api-key");
    expect(result.stdout).toContain("Source");
    expect(result.stdout).not.toContain("User ID");
    // Active organization rows.
    expect(result.stdout).toContain("Organization");
    expect(result.stdout).toContain("cli-e2e-diagnostics-org Org");
    expect(result.stdout).toContain("Org slug");
    expect(result.stdout).toContain("cli-e2e-diagnostics-org");
    expect(result.stdout).toContain("Org ID");
    // role is null → renders as the em-dash fallback `role ?? "—"`.
    expect(result.stdout).toContain("Role");
    expect(result.stdout).toContain("—");
  });

  it("whoami --json emits the whoami envelope with source/actorEmail/activeOrganization", () => {
    const result = cli.runCli("--json", "whoami");
    expect(result.exitCode).toBe(0);
    const envelope = parseEnvelope(result.stdout);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe("whoami");
    expect(envelope.data["source"]).toBe("api-key");
    expect(envelope.data["actorEmail"]).toBe("api-key");
    expect(envelope.data["user"]).toBeNull();
    const activeOrg = envelope.data["activeOrganization"] as Record<string, unknown>;
    expect(activeOrg["slug"]).toBe("cli-e2e-diagnostics-org");
    expect(activeOrg["role"]).toBeNull();
  });

  it("init links the fixture to the seeded project", () => {
    const result = cli.runCli("init");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Project linked successfully");
  });

  it("doctor (human) passes server-reachable + auth + project-linked (exit 0)", () => {
    const result = cli.runCli("doctor");
    // No check returns "fail" in this env (Node >= 22; missing keytool/xcode are
    // "warn" not "fail"; server up; api-key valid; project linked after init),
    // so computeExitCode stays 0 — it only returns 6 on a fail.
    expect(result.exitCode).toBe(0);
    // renderHuman prints a printHumanTable with Check / Detail header cells.
    expect(result.stdout).toContain("Check");
    expect(result.stdout).toContain("Detail");
    // statusIcon("pass") === "[OK]  ".
    expect(result.stdout).toContain("[OK]");
    expect(result.stdout).toContain("Server reachable");
    expect(result.stdout).toContain("returned 200");
    expect(result.stdout).toContain("Auth token");
    // who = me.actorEmail since user is null → "Valid (api-key)".
    expect(result.stdout).toContain("Valid (api-key)");
    expect(result.stdout).toContain("Node.js version");
    expect(result.stdout).toContain("Project linked");
    expect(result.stdout).toContain("projectId=");
  });

  it("doctor --json emits the doctor envelope with a checks array", () => {
    const result = cli.runCli("--json", "doctor");
    expect(result.exitCode).toBe(0);
    const envelope = parseEnvelope(result.stdout);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe("doctor");
    const checks = envelope.data["checks"] as readonly Record<string, unknown>[];
    expect(Array.isArray(checks)).toBe(true);
    expect(checks.some((check) => check["id"] === "auth" && check["status"] === "pass")).toBe(true);
    expect(checks.some((check) => check["id"] === "health" && check["status"] === "pass")).toBe(
      true,
    );
    expect(checks.some((check) => check["id"] === "node")).toBe(true);
  });

  it("projects list (human) shows the seeded project + footer line", () => {
    const result = cli.runCli("projects", "list");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Diagnostics App Project");
    expect(result.stdout).toContain("cli-e2e-diagnostics-app");
    // printHuman footer: `Page <n> · <items> of <total> project(s)`.
    expect(result.stdout).toContain("project(s)");
    expect(result.stdout).toContain("Page 1");
  });

  it("projects list --json emits the projects.list envelope with data.items", () => {
    const result = cli.runCli("--json", "projects", "list");
    expect(result.exitCode).toBe(0);
    const envelope = parseEnvelope(result.stdout);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe("projects.list");
    // printTable keys each row by header name → items[].Slug / items[].Name.
    const items = envelope.data["items"] as readonly Record<string, unknown>[];
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThanOrEqual(1);
    const seeded = items.find((item) => item["Slug"] === "cli-e2e-diagnostics-app");
    expect(seeded).toBeDefined();
    expect(seeded!["Name"]).toBe("Diagnostics App Project");
  });

  it("audit-logs list (human) shows the seeded project.create entry", () => {
    const result = cli.runCli("audit-logs", "list");
    expect(result.exitCode).toBe(0);
    // printList header columns.
    expect(result.stdout).toContain("Action");
    expect(result.stdout).toContain("Resource Type");
    // Harness project creation emits project.create + branch.create + channel.create rows.
    expect(result.stdout).toContain("project.create");
    expect(result.stdout).not.toContain("No audit log entries found.");
  });

  it("audit-logs list --json emits the audit-logs.list envelope with data.items", () => {
    const result = cli.runCli("--json", "audit-logs", "list");
    expect(result.exitCode).toBe(0);
    const envelope = parseEnvelope(result.stdout);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe("audit-logs.list");
    const items = envelope.data["items"] as readonly Record<string, unknown>[];
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThanOrEqual(1);
    // Rows keyed by header name. The seeded rows were created via the harness
    // cookie session, so their Actor is the signup user email — assert only the
    // Action column, never the Actor value.
    expect(items.some((entry) => entry["Action"] === "project.create")).toBe(true);
  });

  // logout clears only the on-disk AuthStore token, but runCli re-injects
  // BETTER_UPDATE_TOKEN on EVERY invocation — so logout has no cross-test effect.
  // Run it LAST anyway to avoid any confusion.
  it("logout (human) clears the token", () => {
    const result = cli.runCli("logout");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Logged out. Auth token removed.");
    // No --all flag → the Apple session line is NOT printed.
    expect(result.stdout).not.toContain("Cleared Apple Developer session.");
  });

  it("logout --json emits the logout envelope", () => {
    const result = cli.runCli("--json", "logout");
    expect(result.exitCode).toBe(0);
    const envelope = parseEnvelope(result.stdout);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe("logout");
    expect(envelope.data["loggedOut"]).toBe(true);
    expect(envelope.data["clearedAppleSession"]).toBe(false);
  });
});
