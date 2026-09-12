import { makeCliSandbox, parseErrorEnvelope } from "./helpers/cli";

import type { CliSandbox } from "./helpers/cli";

describe("env exec: operands after `--`", () => {
  let cli: CliSandbox;
  beforeAll(() => {
    cli = makeCliSandbox();
  });

  afterAll(() => {
    cli.cleanup();
  });

  it("without `--` the command is missing (InvalidArgumentError, exit 2)", async () => {
    const result = await cli.run(["--json", "env", "exec", "production"]);
    expect(result.exitCode).toBe(2);
    const envelope = parseErrorEnvelope(result.stdout);
    expect(envelope.error.tag).toBe("InvalidArgumentError");
    expect(envelope.error.message).toContain("Pass the command after `--`");
  });

  it("`<environment> -- <cmd>` reaches project resolution (the operands are not parsed as flags)", async () => {
    const result = await cli.run([
      "--json",
      "env",
      "exec",
      "production",
      "--",
      "node",
      "--version",
      "--json",
    ]);
    expect(result.exitCode).toBe(4);
    expect(parseErrorEnvelope(result.stdout).error.tag).toBe("ProjectNotLinkedError");
  });

  it("`--profile <p> -- <cmd>` needs no environment positional", async () => {
    const result = await cli.run(["--json", "env", "exec", "--profile", "preview", "--", "true"]);
    expect(result.exitCode).toBe(2);
    const envelope = parseErrorEnvelope(result.stdout);
    expect(envelope.error.tag).toBe("BuildProfileError");
    expect(envelope.error.message).toContain("eas.json");
  });

  it("flags after `--` never leak into the CLI parser", async () => {
    const result = await cli.run([
      "env",
      "exec",
      "production",
      "--",
      "cmd",
      "--definitely-not-a-flag",
    ]);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).not.toContain("Unrecognized flag");
  });
});
