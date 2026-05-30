import { setupCliE2E } from "../helpers/cli-e2e";

const devicesAppJsonTemplate = {
  expo: {
    name: "Devices App",
    slug: "devices-app",
    owner: "devices-cli",
    version: "1.0.0",
    runtimeVersion: "1.0.0",
    ios: {
      bundleIdentifier: "com.example.devicescli",
      buildNumber: "1",
    },
    android: {
      package: "com.example.devicescli",
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

// Devices are ORG-scoped (resolved from the API key's active org via CurrentActor
// on the server), never project-scoped — no `init`, and they do not bundle, so
// OMIT projectDir and let the harness create a fresh temp dir.
const cli = setupCliE2E("e2e-cli-devices", {
  appJsonTemplate: devicesAppJsonTemplate,
  userEmail: "cli-e2e-devices@example.com",
  orgSlug: "cli-e2e-devices-org",
});

// A lowercase 40-hex UDID. The server `normalizeIdentifier` trims + lowercases
// before storing, so we send lowercase and assert the same lowercase value back.
const UDID = "0123456789abcdef0123456789abcdef01234567";

// ── Helpers ──────────────────────────────────────────────────────

interface SuccessEnvelope {
  readonly ok: boolean;
  readonly command: string;
  readonly data: any;
}

// `--json` makes stdout exactly one envelope line. Scan for it defensively in
// case the runner prepends a stray line, then assert `ok`.
const parseEnvelope = (stdout: string): SuccessEnvelope => {
  const line = stdout
    .split("\n")
    .map((raw) => raw.trim())
    .find((text) => text.startsWith("{") && text.includes('"schemaVersion"'));
  expect(line).toBeDefined();
  const envelope = JSON.parse(line!) as SuccessEnvelope;
  expect(envelope.ok).toBe(true);
  return envelope;
};

// ── Tests ────────────────────────────────────────────────────────

describe("devices lifecycle: add / list / view / rename / disable / enable / delete", () => {
  // Captured from the first `add` test and reused top-to-bottom by the rest.
  let deviceId = "";

  it("devices add --udid registers a device (--json) and returns Device data", () => {
    const result = cli.runCli(
      "--json",
      "devices",
      "add",
      "--udid",
      UDID,
      "--name",
      "Test iPhone",
      "--device-class",
      "IPHONE",
    );
    expect(result.exitCode).toBe(0);
    const envelope = parseEnvelope(result.stdout);
    expect(envelope.command).toBe("devices.add");
    expect(envelope.data.id).toStrictEqual(expect.any(String));
    expect((envelope.data.id as string).length).toBeGreaterThan(0);
    deviceId = envelope.data.id as string;
    expect(envelope.data.name).toBe("Test iPhone");
    // Server lowercases + trims the identifier before storing.
    expect(envelope.data.identifier).toBe(UDID);
    expect(envelope.data.deviceClass).toBe("IPHONE");
    expect(envelope.data.enabled).toBe(true);
  });

  it("devices add without --udid and without --invite fails InvalidArgumentError (exit 2)", () => {
    const result = cli.runCli("devices", "add", "--name", "NoUdid");
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      "Pass --udid <udid> --name <name>, or use --invite to generate an enrollment URL.",
    );
  });

  it("devices add --invite generates a registration URL (--json) with url/expiresAt/id", () => {
    const result = cli.runCli(
      "--json",
      "devices",
      "add",
      "--invite",
      "--name",
      "Invited Device",
      "--expires-in",
      "24h",
    );
    expect(result.exitCode).toBe(0);
    const envelope = parseEnvelope(result.stdout);
    expect(envelope.command).toBe("devices.add");
    expect(envelope.data.url).toStrictEqual(expect.any(String));
    expect(envelope.data.url as string).toContain("/register-device/");
    expect(envelope.data.expiresAt).toStrictEqual(expect.any(String));
    expect((envelope.data.expiresAt as string).length).toBeGreaterThan(0);
    expect(envelope.data.id).toStrictEqual(expect.any(String));
    expect((envelope.data.id as string).length).toBeGreaterThan(0);
  });

  it("devices list returns the registered device (--json) with paging fields", () => {
    const result = cli.runCli("--json", "devices", "list");
    expect(result.exitCode).toBe(0);
    const envelope = parseEnvelope(result.stdout);
    expect(envelope.command).toBe("devices.list");
    const items = envelope.data.items as readonly any[];
    expect(Array.isArray(items)).toBe(true);
    const match = items.find((item) => item.id === deviceId);
    expect(match).toBeDefined();
    expect(match!.name).toBe("Test iPhone");
    expect(match!.deviceClass).toBe("IPHONE");
    expect(envelope.data.total).toStrictEqual(expect.any(Number));
    expect(envelope.data.total as number).toBeGreaterThanOrEqual(1);
    expect(envelope.data.page).toBe(1);
    expect(envelope.data.limit).toBe(20);
  });

  it("devices view <id> shows full device details (--json)", () => {
    const result = cli.runCli("--json", "devices", "view", deviceId);
    expect(result.exitCode).toBe(0);
    const envelope = parseEnvelope(result.stdout);
    expect(envelope.command).toBe("devices.view");
    expect(envelope.data.id).toBe(deviceId);
    expect(envelope.data.name).toBe("Test iPhone");
    expect(envelope.data.deviceClass).toBe("IPHONE");
    expect(envelope.data.identifier).toBe(UDID);
    expect(envelope.data.enabled).toBe(true);
    expect(envelope.data.createdAt).toStrictEqual(expect.any(String));
    expect((envelope.data.createdAt as string).length).toBeGreaterThan(0);
    expect(envelope.data.model).toBeNull();
    expect(envelope.data.appleTeamId).toBeNull();
    expect(envelope.data.appleDevicePortalId).toBeNull();
  });

  it("devices view of a non-existent id fails NotFound (exit 1)", () => {
    const result = cli.runCli("devices", "view", "nonexistent-device-id-0000");
    expect(result.exitCode).toBe(1);
    expect(result.exitCode).not.toBe(0);
  });

  it("devices rename <id> --name updates the name", () => {
    const result = cli.runCli(
      "--non-interactive",
      "devices",
      "rename",
      deviceId,
      "--name",
      "Renamed iPhone",
    );
    expect(result.exitCode).toBe(0);
    // rename uses printKeyValue (dual-mode); human stdout shows the new name + id.
    expect(result.stdout).toContain("Renamed iPhone");
    expect(result.stdout).toContain(deviceId);

    const viewResult = cli.runCli("--json", "devices", "view", deviceId);
    expect(viewResult.exitCode).toBe(0);
    const envelope = parseEnvelope(viewResult.stdout);
    expect(envelope.data.name).toBe("Renamed iPhone");
  });

  it("devices disable <id> sets enabled false", () => {
    const result = cli.runCli("--json", "devices", "disable", deviceId);
    expect(result.exitCode).toBe(0);
    // disable uses printKeyValue (dual-mode): --json envelope `data` is keyed by
    // the human LABEL strings (ID/Name/Enabled), not camelCase Device fields.
    const envelope = parseEnvelope(result.stdout);
    expect(envelope.command).toBe("devices.disable");
    expect(envelope.data.ID).toBe(deviceId);
    expect(envelope.data.Name).toStrictEqual(expect.any(String));
    expect(envelope.data.Enabled).toBe("no");

    const viewResult = cli.runCli("--json", "devices", "view", deviceId);
    expect(viewResult.exitCode).toBe(0);
    const viewEnvelope = parseEnvelope(viewResult.stdout);
    expect(viewEnvelope.data.enabled).toBe(false);
  });

  it("devices enable <id> sets enabled true", () => {
    const result = cli.runCli("--json", "devices", "enable", deviceId);
    expect(result.exitCode).toBe(0);
    const envelope = parseEnvelope(result.stdout);
    expect(envelope.command).toBe("devices.enable");
    expect(envelope.data.ID).toBe(deviceId);
    expect(envelope.data.Enabled).toBe("yes");

    const viewResult = cli.runCli("--json", "devices", "view", deviceId);
    expect(viewResult.exitCode).toBe(0);
    const viewEnvelope = parseEnvelope(viewResult.stdout);
    expect(viewEnvelope.data.enabled).toBe(true);
  });

  it("devices list --enabled false filters out the (now enabled) device", () => {
    const result = cli.runCli("--json", "devices", "list", "--enabled", "false");
    expect(result.exitCode).toBe(0);
    const envelope = parseEnvelope(result.stdout);
    expect(envelope.command).toBe("devices.list");
    const items = envelope.data.items as readonly any[];
    // The client-side parseEnabled filter in list.ts drops enabled devices.
    expect(items.every((item) => item.id !== deviceId)).toBe(true);
  });

  it("devices delete <id> --yes removes the device (human output)", () => {
    // delete only calls printHuman (suppressed in --json), so assert human stdout.
    // --yes skips promptConfirm (without it, CI=1 throws InteractiveProhibitedError).
    const result = cli.runCli("--non-interactive", "devices", "delete", deviceId, "--yes");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Deleted device ");
    expect(result.stdout).toContain(deviceId);
  });

  it("devices view of the deleted id now fails NotFound (exit 1)", () => {
    const result = cli.runCli("devices", "view", deviceId);
    expect(result.exitCode).toBe(1);
    expect(result.exitCode).not.toBe(0);
  });

  it("devices delete of a non-existent id fails NotFound (exit 1)", () => {
    const result = cli.runCli(
      "--non-interactive",
      "devices",
      "delete",
      "nonexistent-device-id-0000",
      "--yes",
    );
    expect(result.exitCode).toBe(1);
    expect(result.exitCode).not.toBe(0);
  });
});
