import { setupCliE2E } from "../helpers/cli-e2e";

const cli = setupCliE2E("e2e-cli-webhooks-lifecycle", {
  appJsonTemplate: {
    expo: {
      name: "Webhooks Lifecycle App",
      slug: "webhooks-lifecycle-app",
      owner: "webhooks-lifecycle",
      version: "1.0.0",
      runtimeVersion: "1.0.0",
      ios: { bundleIdentifier: "com.example.webhookslifecycle", buildNumber: "1" },
      android: { package: "com.example.webhookslifecycle", versionCode: 1 },
    },
  },
  userEmail: "cli-e2e-webhooks-lifecycle@example.com",
  orgSlug: "cli-e2e-webhooks-lifecycle-org",
});

// ── Helpers ──────────────────────────────────────────────────────

interface Envelope {
  readonly ok: boolean;
  readonly command: string;
  readonly data?: any;
  readonly error?: { readonly code: number; readonly tag: string };
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

// Threaded across the sequential cases below: set by the create test, read by
// list/view/update/delete. Tests run in file order within a single describe.
let webhookId = "";

// ── Tests ────────────────────────────────────────────────────────

describe("webhooks lifecycle: create / list / view / update / delete", () => {
  it("create returns the webhook with the one-time secret (--json envelope)", () => {
    const result = cli.runCli(
      "--json",
      "webhooks",
      "create",
      "--name",
      "My Hook",
      "--url",
      "https://example.com/hook",
      "--events",
      "update.published,build.completed",
    );
    expect(result.exitCode).toBe(0);

    const envelope = parseEnvelope(result.stdout);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe("webhooks.create");

    const data = envelope.data!;
    // create.ts uses { json: "value" } → data IS the raw WebhookWithSecret.
    expect(data.id).toStrictEqual(expect.any(String));
    expect((data.id as string).length).toBeGreaterThan(0);
    webhookId = data.id as string;

    expect(data.name).toBe("My Hook");
    expect(data.url).toBe("https://example.com/hook");
    expect(data.events).toStrictEqual(["update.published", "build.completed"]);
    // Server forces enabled:true on insert.
    expect(data.enabled).toBe(true);
    // 32 random bytes rendered hex → 64 chars, returned ONCE on create.
    expect(data.secret).toStrictEqual(expect.any(String));
    expect(data.secret as string).toHaveLength(64);
    expect(data.organizationId).toStrictEqual(expect.any(String));
    expect((data.organizationId as string).length).toBeGreaterThan(0);
  });

  it("create with an unknown event fails client-side (InvalidArgumentError, exit 2)", () => {
    const result = cli.runCli(
      "webhooks",
      "create",
      "--name",
      "Bad Event",
      "--url",
      "https://example.com/x",
      "--events",
      "update.published,foo.bar",
    );
    // parseEvents rejects before any server call → InvalidArgumentError → 2.
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      "Unknown event(s): foo.bar. Allowed: update.published, build.completed",
    );
  });

  it("create with a non-http URL is rejected (non-zero exit + error on stderr)", () => {
    const result = cli.runCli(
      "webhooks",
      "create",
      "--name",
      "Bad URL",
      "--url",
      "ftp://nope",
      "--events",
      "update.published",
    );
    // The `CreateWebhookBody.url` pattern (^https?://) is shared by the API
    // contract, so the Effect HttpApiClient encodes the payload client-side and
    // the bad URL is rejected BEFORE the request leaves the CLI. The meaningful
    // contract here is "invalid URL is rejected with a non-zero exit + a message
    // on stderr" — not the precise exit code (client-side parse vs server
    // BadRequest), so we don't couple to it.
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it("list includes the created webhook (--json envelope, data.items)", () => {
    const result = cli.runCli("--json", "webhooks", "list");
    expect(result.exitCode).toBe(0);

    const envelope = parseEnvelope(result.stdout);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe("webhooks.list");

    const items = envelope.data!.items as readonly any[];
    expect(Array.isArray(items)).toBe(true);
    const entry = items.find((item) => item.id === webhookId);
    expect(entry).toBeDefined();
    expect(entry!.name).toBe("My Hook");
    expect(entry!.url).toBe("https://example.com/hook");
    expect(entry!.events as readonly string[]).toHaveLength(2);
    expect(entry!.enabled).toBe(true);
  });

  it("view shows webhook details without the secret (--json envelope)", () => {
    const result = cli.runCli("--json", "webhooks", "view", webhookId);
    expect(result.exitCode).toBe(0);

    const envelope = parseEnvelope(result.stdout);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe("webhooks.view");

    const data = envelope.data!;
    expect(data.id).toBe(webhookId);
    expect(data.name).toBe("My Hook");
    expect(data.url).toBe("https://example.com/hook");
    expect(data.enabled).toBe(true);
    // Created without --project-id; toApiWebhook returns the raw null projectId.
    expect(data.projectId).toBeNull();
    // view never exposes the signing secret.
    expect(Object.hasOwn(data, "secret")).toBe(false);
  });

  it("update renames the webhook and disables it (--json envelope, flat label keys)", () => {
    const result = cli.runCli(
      "--json",
      "webhooks",
      "update",
      webhookId,
      "--name",
      "Renamed Hook",
      "--disable",
    );
    expect(result.exitCode).toBe(0);

    const envelope = parseEnvelope(result.stdout);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe("webhooks.update");

    // update.ts uses the DUAL-MODE printKeyValue → JSON data is a FLAT object
    // keyed by the printed labels (capitalized), NOT the raw webhook object.
    const data = envelope.data!;
    expect(data.ID).toBe(webhookId);
    expect(data.Name).toBe("Renamed Hook");
    expect(data.URL).toBe("https://example.com/hook");
    expect(data.Events).toBe("update.published,build.completed");
    // --disable → enabled:false → rendered "no".
    expect(data.Enabled).toBe("no");
  });

  it("view reflects the update (renamed + disabled)", () => {
    const result = cli.runCli("--json", "webhooks", "view", webhookId);
    expect(result.exitCode).toBe(0);

    const envelope = parseEnvelope(result.stdout);
    expect(envelope.command).toBe("webhooks.view");
    const data = envelope.data!;
    expect(data.name).toBe("Renamed Hook");
    expect(data.enabled).toBe(false);
  });

  it("view of a nonexistent webhook fails NotFound (exit 1)", () => {
    const result = cli.runCli("webhooks", "view", "does-not-exist-id");
    // findById raises NotFound → BASE_TAG_MAP NotFound = 1.
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("not found");
  });

  it("delete removes the webhook (non-interactive, --yes confirm-skip)", () => {
    const result = cli.runCli("--non-interactive", "webhooks", "delete", webhookId, "--yes");
    expect(result.exitCode).toBe(0);
    // delete.ts uses printHuman (no envelope, human-only success line).
    expect(result.stdout).toContain(`Deleted webhook ${webhookId}.`);
  });

  it("delete of a nonexistent webhook SUCCEEDS with exit 0 (idempotent delete)", () => {
    const result = cli.runCli(
      "--non-interactive",
      "webhooks",
      "delete",
      "already-gone-id",
      "--yes",
    );
    // repo.delete returns { deleted: 0 } and never raises NotFound, so deleting
    // a missing id is a no-op success — the divergence from view/update, which
    // DO raise NotFound on a missing id.
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Deleted webhook already-gone-id.");
  });

  it("list no longer contains the deleted webhook", () => {
    const result = cli.runCli("--json", "webhooks", "list");
    expect(result.exitCode).toBe(0);

    const envelope = parseEnvelope(result.stdout);
    expect(envelope.command).toBe("webhooks.list");
    const items = envelope.data!.items as readonly any[];
    expect(items.every((item) => item.id !== webhookId)).toBe(true);
  });
});
