import { expectIs, makeCliSandbox, parseErrorEnvelope } from "./helpers/cli";

import type { CliSandbox } from "./helpers/cli";

describe("flag semantics: negation, repetition, typed values, required flags", () => {
  let cli: CliSandbox;
  beforeAll(() => {
    cli = makeCliSandbox();
  });

  afterAll(() => {
    cli.cleanup();
  });

  it("--no-<flag> negates a boolean flag and is not an unknown flag", async () => {
    // `update publish --no-patches` parses; the run then fails on auth (3),
    // proving the parser accepted the negation (a usage error would be 2).
    const result = await cli.run(["--json", "update", "publish", "--no-patches"]);
    expect(result.exitCode).toBe(3);
    expect(parseErrorEnvelope(result.stdout).error.tag).toBe("AuthRequiredError");
  });

  it("--no-<flag> on a non-boolean flag is a usage error", async () => {
    const result = await cli.run(["--json", "update", "publish", "--no-branch"]);
    expect(result.exitCode).toBe(2);
    expect(parseErrorEnvelope(result.stdout).error.tag).toBe("UsageError");
  });

  it("a flag literally named no-<x> still resolves directly (`--no-bytecode`)", async () => {
    const result = await cli.run(["--json", "update", "publish", "--no-bytecode"]);
    expect(result.exitCode).toBe(3);
  });

  it("tri-state booleans: absent, --flag and --no-flag all parse (`update configure`)", async () => {
    // Fails later on the missing Expo config (4), never on parsing (2).
    for (const args of [[], ["--enabled"], ["--no-enabled"], ["--enable-bsdiff", "--no-enabled"]]) {
      const result = await cli.run(["--json", "update", "configure", ...args]);
      expectIs(args.join(" "), result.exitCode, 4);
      expectIs(
        args.join(" "),
        parseErrorEnvelope(result.stdout).error.tag,
        "ProjectNotLinkedError",
      );
    }
  });

  it("repeatable flags collect every occurrence (`fingerprint compare --build-id a --build-id b`)", async () => {
    const result = await cli.run([
      "--json",
      "fingerprint",
      "compare",
      "--build-id",
      "a",
      "--build-id",
      "b",
      "--update-id",
      "c",
    ]);
    expect(result.exitCode).toBe(2);
    expect(parseErrorEnvelope(result.stdout).error.message).toContain(
      "Compare at most two fingerprints",
    );
  });

  it("repeatable flags also accept the comma-separated form", async () => {
    const result = await cli.run([
      "--json",
      "fingerprint",
      "compare",
      "--build-id",
      "a,b",
      "--update-id",
      "c",
    ]);
    expect(result.exitCode).toBe(2);
    expect(parseErrorEnvelope(result.stdout).error.message).toContain(
      "Compare at most two fingerprints",
    );
  });

  it.each([
    ["abc", "Expected a whole number"],
    ["0", "Expected a positive number"],
    ["=-3", "Expected a positive number"],
    ["1.5", "Expected a whole number"],
  ])("--limit %s is rejected by the parser", async (value, message) => {
    // A leading `-` reads as a flag, so negatives only reach the value via `=`.
    const args = value.startsWith("=") ? [`--limit${value}`] : ["--limit", value];
    const result = await cli.run(["--json", "builds", "list", ...args]);
    expect(result.exitCode).toBe(2);
    const envelope = parseErrorEnvelope(result.stdout);
    expect(envelope.error.tag).toBe("UsageError");
    expect(envelope.error.message).toContain("--limit");
    expect(envelope.error.message).toContain(message);
  });

  it("--limit with a valid integer parses (fails later on the project link, not on parsing)", async () => {
    const result = await cli.run(["--json", "builds", "list", "--limit", "5"]);
    expect(result.exitCode).toBe(4);
  });

  it("an optional integer flag allowing zero accepts 0 (`--patch-base-window 0`)", async () => {
    const result = await cli.run(["--json", "update", "publish", "--patch-base-window", "0"]);
    expect(result.exitCode).toBe(3);
  });

  it("choice flags reject values outside the literal set", async () => {
    const result = await cli.run(["--json", "fingerprint", "compare", "--platform", "mac"]);
    expect(result.exitCode).toBe(2);
    const envelope = parseErrorEnvelope(result.stdout);
    expect(envelope.error.tag).toBe("UsageError");
    expect(envelope.error.message).toContain('"ios" | "android"');
  });

  it("choice positionals reject values outside the literal set", async () => {
    const result = await cli.run(["autocomplete", "pwsh"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('"bash" | "zsh" | "fish"');
  });

  it("a required flag missing is a parser error, not a handler error", async () => {
    const result = await cli.run(["--json", "apple", "sandbox", "delete"]);
    expect(result.exitCode).toBe(2);
    const envelope = parseErrorEnvelope(result.stdout);
    expect(envelope.error.tag).toBe("UsageError");
    expect(envelope.error.message).toContain("Missing required flag: --id");
  });

  it("an env-backed flag falls back to its environment variable", async () => {
    const withoutEnv = await cli.run([
      "--json",
      "apple",
      "sandbox",
      "create",
      "--email",
      "t@example.com",
      "--first-name",
      "A",
      "--last-name",
      "B",
    ]);
    expect(withoutEnv.exitCode).toBe(2);
    expect(parseErrorEnvelope(withoutEnv.stdout).error.message).toContain(
      "Missing required flag: --password",
    );

    const withEnv = await cli.run(
      [
        "--json",
        "apple",
        "sandbox",
        "create",
        "--email",
        "t@example.com",
        "--first-name",
        "A",
        "--last-name",
        "B",
      ],
      { env: { BETTER_UPDATE_SANDBOX_PASSWORD: "from-env" } },
    );
    // Past the parser; now blocked on the Apple ID login (interactive) — exit 4.
    expect(withEnv.exitCode).toBe(4);
    expect(parseErrorEnvelope(withEnv.stdout).error.tag).toBe("InteractiveProhibitedError");
  });

  it("boolean flags accept an explicit true/false value", async () => {
    for (const value of ["true", "false"]) {
      const result = await cli.run(["--json", "devices", "list", "--enabled", value]);
      expectIs(value, result.exitCode, 3);
    }
  });

  it("-y is an alias for --yes", async () => {
    const result = await cli.run(["--json", "devices", "delete", "dev_1", "-y"]);
    expect(result.exitCode).toBe(3);
    expect(parseErrorEnvelope(result.stdout).error.tag).toBe("AuthRequiredError");
  });
});
