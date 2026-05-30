import { setupCliE2E } from "../helpers/cli-e2e";

const channelsAppJsonTemplate = {
  expo: {
    name: "Channels Lifecycle App",
    slug: "channels-lifecycle-app",
    owner: "channels-lifecycle",
    version: "1.0.0",
    runtimeVersion: "1.0.0",
    ios: {
      bundleIdentifier: "com.example.channelslifecycle",
      buildNumber: "1",
    },
    android: {
      package: "com.example.channelslifecycle",
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

const cli = setupCliE2E("e2e-cli-channels-lifecycle", {
  appJsonTemplate: channelsAppJsonTemplate,
  userEmail: "cli-e2e-channels-lifecycle@example.com",
  orgSlug: "cli-e2e-channels-lifecycle-org",
});

// ── Helpers ──────────────────────────────────────────────────────

interface Envelope {
  readonly ok: boolean;
  readonly command: string;
  readonly data: any;
}

// `--json` makes stdout exactly one envelope line. Scan for it defensively in
// case the runner prepends a stray line, then assert `ok` + `command`.
const parseEnvelope = (stdout: string, command: string): Envelope => {
  const line = stdout
    .split("\n")
    .map((raw) => raw.trim())
    .find((text) => text.startsWith("{") && text.includes('"schemaVersion"'));
  expect(line).toBeDefined();
  const envelope = JSON.parse(line!) as Envelope;
  expect(envelope.ok).toBe(true);
  expect(envelope.command).toBe(command);
  return envelope;
};

// Create a channel in --json mode and return its server id (the `ID` label key —
// `create` uses printKeyValue so the JSON data is keyed by the human labels).
const createChannelJson = (name: string, branch: string): string => {
  const result = cli.runCli("--json", "channels", "create", "--name", name, "--branch", branch);
  expect(result.exitCode).toBe(0);
  const envelope = parseEnvelope(result.stdout, "channels.create");
  const id = envelope.data.ID;
  expect(id).toStrictEqual(expect.any(String));
  expect((id as string).length).toBeGreaterThan(0);
  return id as string;
};

// ── State threaded top-to-bottom across the single worker ────────

// The primary channel ("edge"): exercised by view/pause/resume/update/
// delete and the --json rollout chain. The "canary" channel carries the
// human-output rollout asserts so the two never collide on "Rollout already
// active".
let channelId = "";
let canaryId = "";

// ── Tests ────────────────────────────────────────────────────────

describe("channels lifecycle: create/list/view/update/pause/resume/rollout/delete", () => {
  it("init links the temp app to the seeded project", () => {
    const result = cli.runCli("init");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Project linked successfully");
  });

  it("creates a second branch for rollout/update targets", async () => {
    const branchRes = await cli.postAuthorized("/api/branches", {
      projectId: cli.getProjectId(),
      name: "release",
    });
    expect(branchRes.status).toBe(201);
  });

  it("channels create --json wraps the new channel as data", () => {
    const result = cli.runCli("--json", "channels", "create", "--name", "edge", "--branch", "main");
    expect(result.exitCode).toBe(0);
    const envelope = parseEnvelope(result.stdout, "channels.create");
    expect(envelope.data.ID).toStrictEqual(expect.any(String));
    expect((envelope.data.ID as string).length).toBeGreaterThan(0);
    expect(envelope.data.Name).toBe("edge");
    expect(envelope.data.Branch).toBe("main");
    expect(envelope.data.Created).toStrictEqual(expect.any(String));
    channelId = envelope.data.ID as string;
  });

  it("channels create human output prints aligned key/value rows", () => {
    const result = cli.runCli("channels", "create", "--name", "beta", "--branch", "main");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Name");
    expect(result.stdout).toContain("beta");
    expect(result.stdout).toContain("Branch");
    expect(result.stdout).toContain("main");
  });

  it("channels list --json returns items table", () => {
    const result = cli.runCli("--json", "channels", "list");
    expect(result.exitCode).toBe(0);
    const envelope = parseEnvelope(result.stdout, "channels.list");
    const items = envelope.data.items as readonly any[];
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThanOrEqual(2);
    const edge = items.find((entry) => entry.Name === "edge");
    expect(edge).toBeDefined();
    expect(edge!.Branch).toBe("main");
    expect(edge!.Paused).toBe("no");
    expect(edge!.Rollout).toBe("-");
  });

  it("channels list human prints header row", () => {
    const result = cli.runCli("channels", "list");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Name");
    expect(result.stdout).toContain("Branch");
    expect(result.stdout).toContain("Paused");
    expect(result.stdout).toContain("Rollout");
    expect(result.stdout).toContain("production");
  });

  it("channels view by NAME (--json) returns the value-path payload", () => {
    const result = cli.runCli("--json", "channels", "view", "edge");
    expect(result.exitCode).toBe(0);
    const envelope = parseEnvelope(result.stdout, "channels.view");
    expect(envelope.data.id).toBe(channelId);
    expect(envelope.data.name).toBe("edge");
    expect(envelope.data.projectId).toBe(cli.getProjectId());
    expect(envelope.data.branchName).toBe("main");
    expect(envelope.data.isPaused).toBe(false);
    expect(envelope.data.branchMappingJson).toBeNull();
    expect(envelope.data.cacheVersion).toStrictEqual(expect.any(Number));
    expect(envelope.data.createdAt).toStrictEqual(expect.any(String));
  });

  it("channels view human prints labeled key/values", () => {
    const result = cli.runCli("channels", "view", channelId);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Project ID");
    expect(result.stdout).toContain("Cache version");
    expect(result.stdout).toContain("edge");
    expect(result.stdout).toContain("Paused");
    expect(result.stdout).toContain("no");
  });

  it("channels view unknown name fails with exit 2 (ChannelCommandError)", () => {
    const result = cli.runCli("channels", "view", "does-not-exist");
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('Channel "does-not-exist" not found by ID or name.');
  });

  it("channels pause --json marks the channel paused", () => {
    const result = cli.runCli("--json", "channels", "pause", channelId);
    expect(result.exitCode).toBe(0);
    const envelope = parseEnvelope(result.stdout, "channels.pause");
    expect(envelope.data.id).toBe(channelId);
    expect(envelope.data.isPaused).toBe(true);
    expect(envelope.data.name).toBe("edge");
  });

  it("channels resume --json clears paused", () => {
    const result = cli.runCli("--json", "channels", "resume", channelId);
    expect(result.exitCode).toBe(0);
    const envelope = parseEnvelope(result.stdout, "channels.resume");
    expect(envelope.data.isPaused).toBe(false);
    expect(envelope.data.id).toBe(channelId);
  });

  it("channels pause/resume human prints confirmation", () => {
    const paused = cli.runCli("channels", "pause", channelId);
    expect(paused.exitCode).toBe(0);
    expect(paused.stdout).toContain('Channel "edge" paused.');

    const resumed = cli.runCli("channels", "resume", channelId);
    expect(resumed.exitCode).toBe(0);
    expect(resumed.stdout).toContain('Channel "edge" resumed.');
  });

  it("channels update relinks to a different branch (--json)", () => {
    const result = cli.runCli("--json", "channels", "update", channelId, "--branch", "release");
    expect(result.exitCode).toBe(0);
    const envelope = parseEnvelope(result.stdout, "channels.update");
    expect(envelope.data.id).toBe(channelId);
    expect(envelope.data.name).toBe("edge");

    // Relink back to "main" so the rollout test below can target "release" — a
    // rollout to the channel's CURRENT branch 409s ("Cannot rollout to the
    // current branch").
    const relink = cli.runCli("--json", "channels", "update", channelId, "--branch", "main");
    expect(relink.exitCode).toBe(0);
  });

  it("channels update unknown branch fails exit 2", () => {
    const result = cli.runCli("channels", "update", channelId, "--branch", "ghost-branch");
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('Branch "ghost-branch" not found in the linked project.');
  });

  it("rollout create starts a gradual rollout (--json)", () => {
    const result = cli.runCli(
      "--json",
      "channels",
      "rollout",
      "create",
      channelId,
      "--branch",
      "release",
      "--percentage",
      "25",
    );
    expect(result.exitCode).toBe(0);
    const envelope = parseEnvelope(result.stdout, "channels.rollout.create");
    expect(envelope.data.id).toBe(channelId);
    expect(envelope.data.branchMappingJson).toStrictEqual(expect.any(String));
    expect(envelope.data.branchMappingJson).not.toBeNull();
  });

  it("rollout create human prints percentage message", () => {
    canaryId = createChannelJson("canary", "main");
    const result = cli.runCli(
      "channels",
      "rollout",
      "create",
      canaryId,
      "--branch",
      "release",
      "--percentage",
      "10",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      'Started rollout on channel "canary" to branch "release" at 10%.',
    );
  });

  it("rollout create invalid percentage fails exit 2", () => {
    const result = cli.runCli(
      "channels",
      "rollout",
      "create",
      channelId,
      "--branch",
      "release",
      "--percentage",
      "150",
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      '--percentage must be an integer between 1 and 100, got "150".',
    );
  });

  it("rollout update changes percentage (--json)", () => {
    const result = cli.runCli(
      "--json",
      "channels",
      "rollout",
      "update",
      channelId,
      "--percentage",
      "60",
    );
    expect(result.exitCode).toBe(0);
    const envelope = parseEnvelope(result.stdout, "channels.rollout.update");
    expect(envelope.data.id).toBe(channelId);
    expect(envelope.data.branchMappingJson).toStrictEqual(expect.any(String));
    expect(envelope.data.branchMappingJson).not.toBeNull();
  });

  it("rollout complete promotes the new branch (--json)", () => {
    const result = cli.runCli("--json", "channels", "rollout", "complete", channelId);
    expect(result.exitCode).toBe(0);
    const envelope = parseEnvelope(result.stdout, "channels.rollout.complete");
    expect(envelope.data.branchMappingJson).toBeNull();

    const human = cli.runCli("channels", "rollout", "complete", canaryId);
    expect(human.exitCode).toBe(0);
    expect(human.stdout).toContain('Completed rollout on channel "canary".');
  });

  it("rollout complete with no active rollout fails exit 1", () => {
    const result = cli.runCli("channels", "rollout", "complete", channelId);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("No active rollout");
  });

  it("rollout revert restores original branch (human) — fresh rollout on canary", () => {
    // canary was promoted to "release" by the earlier `rollout complete`, so a
    // fresh rollout must target a DIFFERENT branch than its current one ("main"
    // here) — a rollout to the channel's current branch 409s.
    const started = cli.runCli(
      "channels",
      "rollout",
      "create",
      canaryId,
      "--branch",
      "main",
      "--percentage",
      "20",
    );
    expect(started.exitCode).toBe(0);

    const result = cli.runCli("channels", "rollout", "revert", canaryId);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Reverted rollout on channel "canary".');
  });

  it("channels delete removes the channel (--json)", () => {
    const result = cli.runCli("--json", "channels", "delete", channelId);
    expect(result.exitCode).toBe(0);
    const envelope = parseEnvelope(result.stdout, "channels.delete");
    expect(envelope.data.id).toBe(channelId);
    expect(envelope.data.deleted).toBe(true);
  });

  it("channels delete human prints confirmation (canary)", () => {
    const result = cli.runCli("channels", "delete", canaryId);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`Channel ${canaryId} deleted.`);
  });

  it("channels delete nonexistent id fails exit 1", () => {
    const result = cli.runCli("channels", "delete", "chn_does_not_exist");
    expect(result.exitCode).toBe(1);
    expect(result.stderr.length).toBeGreaterThan(0);
  });
});
