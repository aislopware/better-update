import path from "node:path";

import { setupCliE2E } from "../helpers/cli-e2e";

// `fingerprint generate` and the local side of `fingerprint compare` shell out to
// `bunx @expo/fingerprint <projectRoot>`, so they MUST run inside the real fixture
// (which has @expo/fingerprint installed in node_modules).
const FIXTURE_DIR = path.resolve(import.meta.dirname, "../../../../fixtures/e2e-app");

const fingerprintAppJsonTemplate = {
  expo: {
    name: "Fingerprint App",
    slug: "fingerprint-cli-app",
    owner: "fingerprint-cli",
    version: "1.0.0",
    runtimeVersion: "1.0.0",
    ios: {
      bundleIdentifier: "com.example.fingerprintcli",
      buildNumber: "1",
    },
    android: {
      package: "com.example.fingerprintcli",
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

const cli = setupCliE2E("e2e-cli-fingerprint", {
  projectDir: FIXTURE_DIR,
  appJsonTemplate: fingerprintAppJsonTemplate,
  userEmail: "cli-e2e-fingerprint@example.com",
  orgSlug: "cli-e2e-fingerprint-org",
});

// `@expo/fingerprint` can take several seconds on a cold run; spawnSync blocks the
// whole test, so give the producing cases plenty of headroom.
const FINGERPRINT_TIMEOUT = 120_000;

// ── Envelope helpers ─────────────────────────────────────────────

interface FingerprintSource {
  readonly type: string;
}

interface GenerateData {
  readonly hash: string;
  readonly sources: readonly FingerprintSource[];
}

interface CompareSide {
  readonly label: string;
  readonly hash: string;
  readonly hasSources: boolean;
}

interface CompareData {
  readonly side1: CompareSide;
  readonly side2: CompareSide;
  readonly matched: boolean;
}

interface SuccessEnvelope<Data> {
  readonly ok: true;
  readonly command: string;
  readonly data: Data;
}

interface ErrorEnvelope {
  readonly ok: false;
  readonly command: string;
  readonly error: { readonly code: number; readonly tag: string; readonly message: string };
}

// `--json` makes stdout exactly one envelope line (for BOTH success and failure).
// Scan for it defensively in case the runner prepends a stray line.
const findEnvelopeLine = (stdout: string): string => {
  const line = stdout
    .split("\n")
    .map((raw) => raw.trim())
    .find((text) => text.startsWith("{") && text.includes('"schemaVersion"'));
  expect(line).toBeDefined();
  return line!;
};

const parseSuccess = (stdout: string, command: string): unknown => {
  const envelope = JSON.parse(findEnvelopeLine(stdout)) as SuccessEnvelope<unknown>;
  expect(envelope.ok).toBe(true);
  expect(envelope.command).toBe(command);
  return envelope.data;
};

const parseError = (stdout: string): ErrorEnvelope => {
  const envelope = JSON.parse(findEnvelopeLine(stdout)) as ErrorEnvelope;
  expect(envelope.ok).toBe(false);
  expect(envelope.command).toBe("fingerprint.compare");
  return envelope;
};

// Compute the fixture's real local hash once (it depends on node_modules content,
// so it can never be hardcoded). Used by the positional-hash matched case.
const computeLocalHash = (): string => {
  const result = cli.runCli("--json", "fingerprint", "generate");
  expect(result.exitCode).toBe(0);
  const data = parseSuccess(result.stdout, "fingerprint.generate") as GenerateData;
  expect(data.hash.length).toBeGreaterThan(0);
  return data.hash;
};

// ── Tests ────────────────────────────────────────────────────────

describe("fingerprint generate + compare e2e", () => {
  beforeAll(() => {
    // Seed three builds with KNOWN fingerprint hashes so the server-vs-server
    // compare paths have something to resolve. The harness-seeded build
    // (cli.getSeededBuildId()) has fingerprint_hash = NULL and is used only for
    // the no-recorded-hash error case. Single multi-row INSERT — seedSql splits
    // on ';' so NO semicolons may appear inside the string literals.
    const projectId = cli.getProjectId();
    cli.seedSql(
      `INSERT INTO "builds" ("id","project_id","platform","profile","distribution","runtime_version","app_version","build_number","bundle_id","git_ref","git_commit","message","metadata_json","fingerprint_hash","created_at") VALUES ('fp-build-a','${projectId}','ios','production','ad-hoc','1.0.0','1.0.0','1','com.example.fingerprintcli','main','aaaaaaa','seed a','{}','fp_hash_aaaa','2024-04-01T00:00:00Z'),('fp-build-a2','${projectId}','ios','production','ad-hoc','1.0.0','1.0.0','1','com.example.fingerprintcli','main','aaaaaa2','seed a2','{}','fp_hash_aaaa','2024-04-01T00:00:00Z'),('fp-build-b','${projectId}','ios','production','ad-hoc','1.0.0','1.0.0','1','com.example.fingerprintcli','main','bbbbbbb','seed b','{}','fp_hash_bbbb','2024-04-01T00:00:00Z')`,
    );
  });

  it("links the fixture app to the seeded project", () => {
    const result = cli.runCli("init");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Project linked successfully");
  });

  it(
    "generate (--json) computes a real local fingerprint over the fixture",
    () => {
      const result = cli.runCli("--json", "fingerprint", "generate");
      expect(result.exitCode).toBe(0);
      const data = parseSuccess(result.stdout, "fingerprint.generate") as GenerateData;
      expect(data.hash.length).toBeGreaterThan(0);
      expect(Array.isArray(data.sources)).toBe(true);
      expect(data.sources.length).toBeGreaterThan(0);
    },
    FINGERPRINT_TIMEOUT,
  );

  it(
    "generate (human output) prints the hash then the source count",
    () => {
      const result = cli.runCli("fingerprint", "generate");
      expect(result.exitCode).toBe(0);
      // First printHuman line is the bare hash; a later line is `<n> sources`.
      const firstLine = result.stdout
        .split("\n")
        .map((raw) => raw.trim())
        .find((text) => text.length > 0);
      expect(firstLine).toBeDefined();
      expect(firstLine!).toMatch(/^[0-9a-f]+$/u);
      expect(result.stdout).toMatch(/\d+ sources/u);
    },
    FINGERPRINT_TIMEOUT,
  );

  it(
    "generate --platform ios computes a per-platform fingerprint",
    () => {
      const result = cli.runCli("--json", "fingerprint", "generate", "--platform", "ios");
      expect(result.exitCode).toBe(0);
      const data = parseSuccess(result.stdout, "fingerprint.generate") as GenerateData;
      expect(data.hash.length).toBeGreaterThan(0);
    },
    FINGERPRINT_TIMEOUT,
  );

  it(
    "compare positional-hash vs local — matching (exit 0)",
    () => {
      const localHash = computeLocalHash();
      const result = cli.runCli("--json", "fingerprint", "compare", localHash);
      expect(result.exitCode).toBe(0);
      const data = parseSuccess(result.stdout, "fingerprint.compare") as CompareData;
      expect(data.matched).toBe(true);
      expect(data.side1.hash).toBe(localHash);
      expect(data.side1.label).toBe("provided hash");
      expect(data.side2.label).toBe("local project");
      // The provided hash carries no sources, so this is the hash-level branch.
      expect(data.side1.hasSources).toBe(false);
    },
    FINGERPRINT_TIMEOUT,
  );

  it(
    "compare positional-hash vs local — mismatch (FingerprintMismatchError, exit 1)",
    () => {
      const result = cli.runCli(
        "--json",
        "fingerprint",
        "compare",
        "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      );
      expect(result.exitCode).toBe(1);
      const envelope = parseError(result.stdout);
      expect(envelope.error.tag).toBe("FingerprintMismatchError");
      expect(envelope.error.code).toBe(1);
      expect(envelope.error.message).toContain("Fingerprint mismatch.");
      expect(envelope.error.message).toContain("Source-level diff unavailable");
    },
    FINGERPRINT_TIMEOUT,
  );

  it("compare two server build ids with EQUAL fingerprint hashes — matched (exit 0)", () => {
    const result = cli.runCli(
      "--json",
      "fingerprint",
      "compare",
      "--build-id",
      "fp-build-a,fp-build-a2",
    );
    expect(result.exitCode).toBe(0);
    const data = parseSuccess(result.stdout, "fingerprint.compare") as CompareData;
    expect(data.matched).toBe(true);
    expect(data.side1.hash).toBe("fp_hash_aaaa");
    expect(data.side2.hash).toBe("fp_hash_aaaa");
    expect(data.side1.label).toBe("build fp-build-a");
    // Neither server side exposes sources -> pure hash-level matched, no `diff`.
    expect(data.side1.hasSources).toBe(false);
    expect(data.side2.hasSources).toBe(false);
  });

  it("compare two server build ids with DIFFERING hashes — mismatch (exit 1)", () => {
    const result = cli.runCli(
      "--json",
      "fingerprint",
      "compare",
      "--build-id",
      "fp-build-a,fp-build-b",
    );
    expect(result.exitCode).toBe(1);
    const envelope = parseError(result.stdout);
    expect(envelope.error.tag).toBe("FingerprintMismatchError");
    expect(envelope.error.code).toBe(1);
    expect(envelope.error.message).toContain("Fingerprint mismatch.");
    expect(envelope.error.message).toContain("build fp-build-a: fp_hash_aaaa");
    expect(envelope.error.message).toContain("build fp-build-b: fp_hash_bbbb");
    expect(envelope.error.message).toContain("Source-level diff unavailable");
  });

  it("compare against a build with NO recorded fingerprint hash — FingerprintError (exit 2)", () => {
    const result = cli.runCli(
      "--json",
      "fingerprint",
      "compare",
      "--build-id",
      `${cli.getSeededBuildId()},fp-build-a`,
    );
    expect(result.exitCode).toBe(2);
    const envelope = parseError(result.stdout);
    expect(envelope.error.tag).toBe("FingerprintError");
    expect(envelope.error.code).toBe(2);
    expect(envelope.error.message).toContain("no recorded fingerprint hash");
  });

  it("compare with no args — FingerprintError nothing-to-compare (exit 2)", () => {
    const result = cli.runCli("--json", "fingerprint", "compare");
    expect(result.exitCode).toBe(2);
    const envelope = parseError(result.stdout);
    expect(envelope.error.tag).toBe("FingerprintError");
    expect(envelope.error.code).toBe(2);
    expect(envelope.error.message).toContain("Nothing to compare");
  });

  it("compare with more than two ids — FingerprintError cap (exit 2)", () => {
    const result = cli.runCli(
      "--json",
      "fingerprint",
      "compare",
      "--build-id",
      "fp-build-a,fp-build-b",
      "--update-id",
      "some-update-id",
    );
    expect(result.exitCode).toBe(2);
    const envelope = parseError(result.stdout);
    expect(envelope.error.tag).toBe("FingerprintError");
    expect(envelope.error.code).toBe(2);
    expect(envelope.error.message).toContain("Compare at most two fingerprints");
  });
});
