import { readFileSync } from "node:fs";
import path from "node:path";

import {
  allCommandPaths,
  expectContains,
  expectIs,
  expectLength,
  groupCommandPaths,
  leafCommandPaths,
  makeCliSandbox,
  mapConcurrently,
} from "./helpers/cli";

import type { CliSandbox } from "./helpers/cli";

const pkg = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../../package.json"), "utf8"),
) as { version: string };

describe("help surface", () => {
  let cli: CliSandbox;
  beforeAll(() => {
    cli = makeCliSandbox();
  });

  afterAll(() => {
    cli.cleanup();
  });

  it("bare invocation, --help and -h render the root help on stdout and exit 0", async () => {
    for (const args of [[], ["--help"], ["-h"]]) {
      const result = await cli.run(args);
      expectIs(args.join(" "), result.exitCode, 0);
      expect(result.stdout).toContain("USAGE");
      expect(result.stdout).toContain("better-update <subcommand> [flags]");
      expect(result.stderr).toBe("");
    }
  });

  it("root help lists every top-level command and the three global flags", async () => {
    const result = await cli.run(["--help"]);
    for (const top of allCommandPaths().filter((entry) => entry.tokens.length === 1)) {
      expect(result.stdout).toMatch(new RegExp(`^\\s+${top.tokens[0]}\\s`, "m"));
    }
    expect(result.stdout).toContain("--json");
    expect(result.stdout).toContain("--non-interactive");
    expect(result.stdout).toContain("--interactive");
  });

  it("--version / -v print the package version", async () => {
    for (const flag of ["--version", "-v"]) {
      const result = await cli.run([flag]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe(`better-update v${pkg.version}`);
    }
  });

  it("every command group renders its help when invoked bare (or runs its default handler cleanly)", async () => {
    // Groups with a default handler (`org`, `credentials`, `credentials identity`, …)
    // run that handler instead: it needs auth or a prompt, so it fails with a
    // documented exit code and a one-line stderr message — never a hang, never
    // a crash (exit 1 + stack trace).
    const results = await mapConcurrently(groupCommandPaths(), 12, async (entry) => ({
      entry,
      result: await cli.run(entry.tokens),
    }));
    for (const { entry, result } of results) {
      const label = entry.tokens.join(" ");
      expectIs(label, result.timedOut, false);
      if (result.exitCode === 0) {
        expectContains(label, result.stdout, `better-update ${label} <subcommand>`);
      } else {
        expectContains(label, [2, 3, 4], result.exitCode);
        expectIs(label, result.stdout, "");
        expectLength(label, result.stderr.trim().split("\n"), 1);
      }
    }
  }, 240_000);

  it("every leaf command renders --help with its full path (exit 0, stderr empty)", async () => {
    const results = await mapConcurrently(leafCommandPaths(), 12, async (entry) => ({
      entry,
      result: await cli.run([...entry.tokens, "--help"]),
    }));
    for (const { entry, result } of results) {
      const label = entry.tokens.join(" ");
      expectIs(label, result.exitCode, 0);
      expectIs(label, result.stderr, "");
      expectContains(label, result.stdout, `better-update ${label}`);
      expectContains(label, result.stdout, "USAGE");
    }
  }, 240_000);

  it("unknown subcommand at the root is a usage error (exit 2, help + ERROR)", async () => {
    const result = await cli.run(["bogus"]);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("USAGE");
    expect(result.stderr).toContain('Unknown subcommand "bogus"');
  });

  it("unknown subcommand under a group is a usage error", async () => {
    const result = await cli.run(["devices", "bogus"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Unknown subcommand");
  });

  it("unrecognized flag is a usage error naming the flag and the command", async () => {
    const result = await cli.run(["devices", "list", "--bogus"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      "Unrecognized flag: --bogus in command better-update devices list",
    );
  });

  it("stray positional on a leaf is a usage error", async () => {
    const result = await cli.run(["devices", "list", "extra"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('Unexpected positional argument: "extra"');
  });

  it("missing required positional is a usage error", async () => {
    const result = await cli.run(["autocomplete"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Missing required argument: shell");
  });

  it("missing required flag is a usage error", async () => {
    const result = await cli.run(["submit"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Missing required flag: --platform");
  });
});
