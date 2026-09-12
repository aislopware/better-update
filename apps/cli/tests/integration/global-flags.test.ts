import { expectIs, expectNotContains, makeCliSandbox, parseErrorEnvelope } from "./helpers/cli";

import type { CliSandbox } from "./helpers/cli";

// `login --api-key` prompts for a token BEFORE any auth or network — the
// cleanest probe for "would this run prompt?".
const PROMPTING_COMMAND = ["login", "--api-key"] as const;

describe("global flags: --json / --non-interactive / --interactive / CI", () => {
  let cli: CliSandbox;
  beforeAll(() => {
    cli = makeCliSandbox();
  });

  afterAll(() => {
    cli.cleanup();
  });

  it("--json is accepted before the command, between tokens, and after the leaf", async () => {
    for (const args of [
      ["--json", "devices", "list"],
      ["devices", "--json", "list"],
      ["devices", "list", "--json"],
    ]) {
      const result = await cli.run(args);
      expectIs(args.join(" "), result.exitCode, 3);
      expectIs(args.join(" "), parseErrorEnvelope(result.stdout).command, "devices.list");
      expectIs(args.join(" "), result.stderr, "");
    }
  });

  it("the first --json / --no-json occurrence decides (parser semantics)", async () => {
    const humanFirst = await cli.run(["--no-json", "devices", "list", "--json"]);
    expect(humanFirst.exitCode).toBe(3);
    expect(humanFirst.stdout).toBe("");
    expect(humanFirst.stderr).toContain("Not logged in");

    const jsonFirst = await cli.run(["--json", "devices", "list", "--no-json"]);
    expect(jsonFirst.exitCode).toBe(3);
    expect(parseErrorEnvelope(jsonFirst.stdout).command).toBe("devices.list");
  });

  it("explicit boolean values are honoured: `--json true` / `--json=true` / `--json false`", async () => {
    for (const args of [
      ["--json", "true", "devices", "list"],
      ["--json=true", "devices", "list"],
      ["devices", "--json", "true", "list"],
    ]) {
      const result = await cli.run(args);
      expectIs(args.join(" "), result.exitCode, 3);
      expectIs(args.join(" "), parseErrorEnvelope(result.stdout).command, "devices.list");
    }
    // `--json false` is human mode all the way down: a usage error renders
    // help + the error as text (no JSON envelope anywhere).
    const human = await cli.run(["--json", "false", "devices", "list", "--definitely-not-a-flag"]);
    expect(human.exitCode).toBe(2);
    expect(human.stdout).toContain("USAGE");
    expect(human.stdout).not.toContain('"UsageError"');
    expect(human.stderr).toContain("--definitely-not-a-flag");
  });

  it("the interactive `--wizard` built-in is not mounted (it would prompt before any gate)", async () => {
    const result = await cli.run(["--json", "--wizard", ...PROMPTING_COMMAND], {
      env: { CI: undefined },
      timeoutMs: 10_000,
    });
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(parseErrorEnvelope(result.stdout).error.tag).toBe("UsageError");
    expect(result.stderr).toContain("--wizard");
  });

  it("`--log-level <level>` is consumed as a value, never as a command segment", async () => {
    const result = await cli.run(["--json", "--log-level", "debug", "devices", "list"]);
    expect(result.exitCode).toBe(3);
    expect(parseErrorEnvelope(result.stdout).command).toBe("devices.list");
  });

  it("human mode: errors go to stderr, stdout stays empty", async () => {
    const result = await cli.run(["devices", "list"]);
    expect(result.exitCode).toBe(3);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim()).toBe("Not logged in. Run `better-update login` to authenticate.");
  });

  it("--json forbids prompts: InteractiveProhibitedError envelope, exit 2", async () => {
    const result = await cli.run(["--json", ...PROMPTING_COMMAND], { env: { CI: undefined } });
    expect(result.exitCode).toBe(2);
    expect(parseErrorEnvelope(result.stdout)).toMatchObject({
      command: "login",
      error: { code: 2, tag: "InteractiveProhibitedError" },
    });
  });

  it("--json wins over an explicit --interactive (the stdout contract is stronger)", async () => {
    const result = await cli.run(["--json", "--interactive", ...PROMPTING_COMMAND], {
      env: { CI: undefined },
    });
    expect(result.exitCode).toBe(2);
    expect(parseErrorEnvelope(result.stdout).error.tag).toBe("InteractiveProhibitedError");
  });

  it("--non-interactive forbids prompts in human mode (stderr message, exit 2)", async () => {
    const result = await cli.run(["--non-interactive", ...PROMPTING_COMMAND], {
      env: { CI: undefined },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("requested while running non-interactively");
  });

  it.each([
    ["CI=1", "1"],
    ["CI=true", "true"],
  ])("%s alone forbids prompts", async (_label, ci) => {
    const result = await cli.run([...PROMPTING_COMMAND], { env: { CI: ci } });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("requested while running non-interactively");
  });

  it("CI=false / CI=0 do not count as CI", async () => {
    // Without a TTY the prompt gets EOF → cancelled (exit 130), which proves the
    // gate let the prompt start rather than refusing it up front.
    for (const ci of ["false", "0"]) {
      const result = await cli.run([...PROMPTING_COMMAND], { env: { CI: ci }, timeoutMs: 10_000 });
      expectIs(`CI=${ci}`, result.timedOut, false);
      expectNotContains(`CI=${ci}`, result.stderr, "requested while running non-interactively");
    }
  });

  it("browser login refuses to run non-interactively instead of waiting for a callback", async () => {
    const result = await cli.run(["login"], { timeoutMs: 10_000 });
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Browser login requested while running non-interactively");
    expect(result.stderr).toContain("BETTER_UPDATE_ROBOT");
  });

  it("global flags are rejected per-command as duplicates: no leaf redeclares them", async () => {
    // `--json --json` is fine (same global flag twice); what must NOT exist is
    // a leaf-level `--json` that shadows the global one — the parser would then
    // report it as unrecognized in the leaf scope. Spot-check a leaf + a group.
    for (const args of [
      ["devices", "list", "--json", "--json"],
      ["credentials", "list", "--non-interactive", "--json"],
    ]) {
      const result = await cli.run(args);
      expectIs(args.join(" "), result.exitCode, 3);
      expectIs(args.join(" "), parseErrorEnvelope(result.stdout).error.tag, "AuthRequiredError");
    }
  });
});
