import path from "node:path";

import { setupCliE2E } from "../helpers/cli-e2e";

const FIXTURE_DIR = path.resolve(import.meta.dirname, "../../../../fixtures/e2e-app");

const bsdiffAppJsonTemplate = {
  expo: {
    name: "Bsdiff Flags App",
    slug: "bsdiff-flags-app",
    owner: "bsdiff-flags",
    version: "1.0.0",
    runtimeVersion: "1.0.0",
    ios: {
      bundleIdentifier: "com.example.bsdiffflags",
      buildNumber: "1",
    },
    android: {
      package: "com.example.bsdiffflags",
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

const cli = setupCliE2E("e2e-cli-bsdiff-flags", {
  projectDir: FIXTURE_DIR,
  appJsonTemplate: bsdiffAppJsonTemplate,
  userEmail: "cli-e2e-bsdiff-flags@example.com",
  orgSlug: "cli-e2e-bsdiff-flags-org",
});

// ── Helpers ──────────────────────────────────────────────────────

interface PatchPhase {
  readonly attempted: number;
  readonly uploaded: number;
  readonly skipped: number;
  readonly bestSavingsPct?: number;
}

interface PublishResultEntry {
  readonly platform: string;
  readonly updateId: string;
  readonly patches: PatchPhase | null;
}

interface PublishData {
  readonly groupId: string;
  readonly branch: string;
  readonly results: readonly PublishResultEntry[];
}

// `--json` makes stdout exactly one envelope line. Scan for it defensively in
// case the runner prepends a stray line, then unwrap `data`.
const parsePublishEnvelope = (stdout: string): PublishData => {
  const line = stdout
    .split("\n")
    .map((raw) => raw.trim())
    .find((text) => text.startsWith("{") && text.includes('"schemaVersion"'));
  expect(line).toBeDefined();
  const envelope = JSON.parse(line!) as { ok: boolean; command: string; data: PublishData };
  expect(envelope.ok).toBe(true);
  expect(envelope.command).toBe("update.publish");
  return envelope.data;
};

const iosPatchesOf = (data: PublishData): PatchPhase | null => {
  const ios = data.results.find((entry) => entry.platform === "ios");
  expect(ios).toBeDefined();
  return ios!.patches;
};

// Publish ios on `main` in --json mode and return the parsed ios patch phase.
const publishIos = (...extraArgs: readonly string[]): PublishData => {
  const result = cli.runCli(
    "--json",
    "update",
    "publish",
    "--branch",
    "main",
    "--platform",
    "ios",
    "--allow-dirty",
    ...extraArgs,
  );
  expect(result.exitCode).toBe(0);
  return parsePublishEnvelope(result.stdout);
};

// ── Tests ────────────────────────────────────────────────────────

describe("update publish bsdiff flags: --no-patches / --patch-base-window", () => {
  it("links the fixture app to the seeded project", () => {
    const result = cli.runCli("init");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Project linked successfully");
  });

  it("first publish has no base to diff against (attempted 0)", () => {
    // v1: nothing published yet and no embedded baseline → the phase runs but
    // finds zero candidate bases.
    const patches = iosPatchesOf(publishIos());
    expect(patches).not.toBeNull();
    expect(patches!.attempted).toBe(0);
    expect(patches!.uploaded).toBe(0);
  });

  it("second publish precomputes a bsdiff patch against the prior update", () => {
    // v2: v1 is now a recent base in the default window, so the patch phase
    // attempts (and, with a working producer, uploads) a v1→v2 bsdiff patch.
    // This is the precompute-at-publish path exercised end-to-end through the
    // CLI + server + local R2 — not hand-seeded like the integration test.
    const patches = iosPatchesOf(publishIos("--message", "v2"));
    expect(patches).not.toBeNull();
    expect(patches!.attempted).toBeGreaterThanOrEqual(1);
    // The producer is portable (runs under bun): a real patch is uploaded and
    // it is smaller than the full bundle.
    expect(patches!.uploaded).toBeGreaterThanOrEqual(1);
    expect(patches!.bestSavingsPct).toBeGreaterThan(0);
  });

  it("--no-patches skips the patch phase entirely (patches: null)", () => {
    // v3 with the phase disabled: the result carries an explicit null, distinct
    // from a phase that ran with zero candidates ({ attempted: 0 }).
    const patches = iosPatchesOf(publishIos("--no-patches", "--message", "v3"));
    expect(patches).toBeNull();
  });

  it("--patch-base-window 0 runs the phase but diffs the embedded baseline only", () => {
    // v4: window 0 means "embedded baseline only". There is no embedded baseline
    // in this project, so the phase runs (non-null) but caps every recent base
    // out, attempting none — proving the window flag is honored and is NOT the
    // same code path as --no-patches.
    const patches = iosPatchesOf(publishIos("--patch-base-window", "0", "--message", "v4"));
    expect(patches).not.toBeNull();
    expect(patches!.attempted).toBe(0);
  });
});
