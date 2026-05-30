import { setupCliE2E } from "../helpers/cli-e2e";

const branchesAppJsonTemplate = {
  expo: {
    name: "Branches Lifecycle App",
    slug: "branches-lifecycle-app",
    owner: "branches-lifecycle",
    version: "1.0.0",
    runtimeVersion: "1.0.0",
    ios: { bundleIdentifier: "com.example.brancheslifecycle", buildNumber: "1" },
    android: { package: "com.example.brancheslifecycle", versionCode: 1 },
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

const cli = setupCliE2E("e2e-cli-branches-lifecycle", {
  appJsonTemplate: branchesAppJsonTemplate,
  userEmail: "cli-e2e-branches-lifecycle@example.com",
  orgSlug: "cli-e2e-branches-lifecycle-org",
});

// ── Helpers ──────────────────────────────────────────────────────

interface Envelope {
  readonly schemaVersion: number;
  readonly ok: boolean;
  readonly command: string;
  // envelope `data`/`error` shape varies per command; tests narrow at the assertion site
  readonly data?: any;
  readonly error?: any;
}

// `--json` makes stdout exactly one envelope line. Scan for it defensively in
// case the runner prepends a stray line.
const parseEnvelope = (stdout: string): Envelope => {
  const line = stdout
    .split("\n")
    .map((raw) => raw.trim())
    .find((text) => text.startsWith("{") && text.includes('"schemaVersion"'));
  expect(line).toBeDefined();
  return JSON.parse(line!) as Envelope;
};

// Created-branch id shared across create → view → rename → delete.
let createdId = "";

// ── Tests ────────────────────────────────────────────────────────

describe("branches lifecycle: list / view / create / rename / delete", () => {
  it("links the fixture app to the seeded project (init)", () => {
    const result = cli.runCli("init");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Project linked successfully");
  });

  it("create: creates a branch and returns its fields (--json)", () => {
    const result = cli.runCli("--json", "branches", "create", "--name", "release-1");
    expect(result.exitCode).toBe(0);

    const envelope = parseEnvelope(result.stdout);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe("branches.create");
    expect(envelope.schemaVersion).toBe(1);

    // create uses printKeyValue → data keyed by HUMAN HEADERS { ID, Name, Created }.
    expect(envelope.data.ID).toStrictEqual(expect.any(String));
    expect(envelope.data.ID.length).toBeGreaterThan(0);
    expect(envelope.data.Name).toBe("release-1");
    expect(envelope.data.Created).toStrictEqual(expect.any(String));
    expect(envelope.data.Created.length).toBeGreaterThan(0);

    createdId = envelope.data.ID;
  });

  it("create (human): prints aligned ID/Name/Created key-value rows", () => {
    const result = cli.runCli("branches", "create", "--name", "release-2");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("ID");
    expect(result.stdout).toContain("Name");
    expect(result.stdout).toContain("Created");
    expect(result.stdout).toContain("release-2");
  });

  it("list: includes the seeded main branch and created branches (--json)", () => {
    const result = cli.runCli("--json", "branches", "list");
    expect(result.exitCode).toBe(0);

    const envelope = parseEnvelope(result.stdout);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe("branches.list");

    // list uses printList → printTable → data is { items: [{ ID, Name, Created }] }.
    expect(Array.isArray(envelope.data.items)).toBe(true);
    expect(envelope.data.items.some((entry: any) => entry.Name === "main")).toBe(true);
    expect(envelope.data.items.some((entry: any) => entry.Name === "release-1")).toBe(true);
    for (const entry of envelope.data.items) {
      expect(entry.ID).toStrictEqual(expect.any(String));
      expect(entry.Created).toStrictEqual(expect.any(String));
    }
  });

  it("list (human): empty-vs-populated table prints the main row", () => {
    const result = cli.runCli("branches", "list");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("ID");
    expect(result.stdout).toContain("Name");
    expect(result.stdout).toContain("Created");
    expect(result.stdout).toContain("main");
    expect(result.stdout).not.toContain("No branches found.");
  });

  it("view by ID: returns the full Branch payload (--json)", () => {
    const result = cli.runCli("--json", "branches", "view", createdId);
    expect(result.exitCode).toBe(0);

    const envelope = parseEnvelope(result.stdout);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe("branches.view");

    // view uses runEffect({ json: "value" }) → data IS the Branch object (lowercase fields).
    expect(envelope.data.id).toBe(createdId);
    expect(envelope.data.name).toBe("release-1");
    expect(envelope.data.projectId).toBe(cli.getProjectId());
    expect(envelope.data.updateCount).toBe(0);
    expect(envelope.data.createdAt).toStrictEqual(expect.any(String));
    expect(envelope.data.createdAt.length).toBeGreaterThan(0);
  });

  it("view by name: falls back to project branch lookup when ID lookup 404s (--json)", () => {
    const result = cli.runCli("--json", "branches", "view", "main");
    expect(result.exitCode).toBe(0);

    const envelope = parseEnvelope(result.stdout);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe("branches.view");
    expect(envelope.data.name).toBe("main");
    expect(envelope.data.projectId).toBe(cli.getProjectId());
    expect(envelope.data.updateCount).toBe(0);
  });

  it("view (human) by ID: prints all five key-value rows", () => {
    const result = cli.runCli("branches", "view", createdId);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("ID");
    expect(result.stdout).toContain("Name");
    expect(result.stdout).toContain("Project ID");
    expect(result.stdout).toContain("Updates");
    expect(result.stdout).toContain("Created");
    expect(result.stdout).toContain(createdId);
    expect(result.stdout).toContain("release-1");
  });

  it("view: unknown name not found by ID or name → InvalidArgumentError (exit 2)", () => {
    const result = cli.runCli("branches", "view", "does-not-exist-xyz");
    expect(result.exitCode).toBe(2);
    const combined = `${result.stdout}\n${result.stderr}`;
    expect(combined).toContain('Branch "does-not-exist-xyz" not found by ID or name.');

    // --json variant: assert the error envelope.
    const jsonResult = cli.runCli("--json", "branches", "view", "does-not-exist-xyz");
    expect(jsonResult.exitCode).toBe(2);
    const envelope = parseEnvelope(jsonResult.stdout);
    expect(envelope.ok).toBe(false);
    expect(envelope.error.tag).toBe("InvalidArgumentError");
    expect(envelope.error.code).toBe(2);
  });

  it("rename: renames a branch and confirms (--json)", () => {
    const result = cli.runCli(
      "--json",
      "branches",
      "rename",
      createdId,
      "--name",
      "release-1-renamed",
    );
    expect(result.exitCode).toBe(0);

    const envelope = parseEnvelope(result.stdout);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe("branches.rename");
    expect(envelope.data.id).toBe(createdId);
    expect(envelope.data.name).toBe("release-1-renamed");
  });

  it("rename (human): prints confirmation line", () => {
    const result = cli.runCli("branches", "rename", createdId, "--name", "release-1-final");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Branch renamed to "release-1-final".');
  });

  it("rename: nonexistent UUID → NotFound (exit 1)", () => {
    const result = cli.runCli(
      "--json",
      "branches",
      "rename",
      "00000000-0000-0000-0000-000000000000",
      "--name",
      "nope",
    );
    expect(result.exitCode).toBe(1);

    const envelope = parseEnvelope(result.stdout);
    expect(envelope.ok).toBe(false);
    expect(envelope.error.tag).toBe("NotFound");
    expect(envelope.error.code).toBe(1);
  });

  it("delete: deletes a branch and confirms (--json)", () => {
    const result = cli.runCli("--json", "branches", "delete", createdId);
    expect(result.exitCode).toBe(0);

    const envelope = parseEnvelope(result.stdout);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe("branches.delete");
    expect(envelope.data.id).toBe(createdId);
    expect(envelope.data.deleted).toBe(true);
  });

  it("delete (human): prints deletion line for a second created branch", () => {
    const made = parseEnvelope(
      cli.runCli("--json", "branches", "create", "--name", "to-delete").stdout,
    );
    expect(made.ok).toBe(true);
    const targetId = made.data.ID;

    const result = cli.runCli("branches", "delete", targetId);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`Branch ${targetId} deleted.`);
  });

  it("delete: nonexistent UUID → NotFound (exit 1)", () => {
    const result = cli.runCli(
      "--json",
      "branches",
      "delete",
      "00000000-0000-0000-0000-000000000000",
    );
    expect(result.exitCode).toBe(1);

    const envelope = parseEnvelope(result.stdout);
    expect(envelope.ok).toBe(false);
    expect(envelope.error.tag).toBe("NotFound");
    expect(envelope.error.code).toBe(1);
  });

  it("create: duplicate name is rejected with Conflict (exit 1)", () => {
    // The branches repo enforces a per-project UNIQUE(name) (D1 constraint →
    // Conflict, message: `A branch named "..." already exists in this project`).
    // "main" was seeded by the harness, so a second create with the same name is
    // rejected — not silently allowed.
    const result = cli.runCli("--json", "branches", "create", "--name", "main");
    expect(result.exitCode).toBe(1);

    const envelope = parseEnvelope(result.stdout);
    expect(envelope.ok).toBe(false);
    expect(envelope.error.tag).toBe("Conflict");
    expect(envelope.error.code).toBe(1);
  });
});
