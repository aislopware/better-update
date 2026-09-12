import { makeCliSandbox, parseEnvelope } from "./helpers/cli";

import type { CliSandbox } from "./helpers/cli";

describe("entrypoint: completions, maintenance path, streams", () => {
  let cli: CliSandbox;
  beforeAll(() => {
    cli = makeCliSandbox();
  });

  afterAll(() => {
    cli.cleanup();
  });

  it.each([
    ["bash", "better-update"],
    ["zsh", "#compdef better-update"],
    ["fish", "better-update"],
  ])("autocomplete %s prints a completion script on stdout", async (shell, marker) => {
    const result = await cli.run(["autocomplete", shell]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(marker);
    expect(result.stdout.length).toBeGreaterThan(200);
  });

  it("`autocomplete zsh` and the built-in `--completions zsh` produce the same script", async () => {
    const viaCommand = await cli.run(["autocomplete", "zsh"]);
    const viaBuiltIn = await cli.run(["--completions", "zsh"]);
    expect(viaBuiltIn.exitCode).toBe(0);
    expect(viaCommand.stdout).toBe(viaBuiltIn.stdout);
  });

  it("`--json autocomplete <shell>` wraps the script in the envelope instead of printing it raw", async () => {
    const human = await cli.run(["autocomplete", "zsh"]);
    const result = await cli.run(["--json", "autocomplete", "zsh"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(parseEnvelope(result.stdout)).toStrictEqual({
      schemaVersion: 1,
      ok: true,
      command: "autocomplete",
      data: { shell: "zsh", script: human.stdout.replace(/\n$/u, "") },
    });
  });

  it("the completion script knows every top-level command", async () => {
    const result = await cli.run(["autocomplete", "bash"]);
    for (const name of ["devices", "credentials", "update", "app-store", "autocomplete"]) {
      expect(result.stdout).toContain(name);
    }
  });

  it("the detached version-cache refresh path exits 0 silently", async () => {
    const result = await cli.run(["__refresh-version-cache"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("--json --help renders help on stderr and leaves stdout empty", async () => {
    const result = await cli.run(["--json", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("USAGE");
  });

  it("--json on a bare group renders help on stderr and leaves stdout empty", async () => {
    const result = await cli.run(["--json", "devices"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("better-update devices <subcommand>");
  });
});
