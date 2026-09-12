import { expectIs, makeCliSandbox, parseEnvelope, parseErrorEnvelope } from "./helpers/cli";

import type { CliSandbox } from "./helpers/cli";

describe("JSON envelope: command name resolution + exit-code policy", () => {
  let cli: CliSandbox;
  beforeAll(() => {
    cli = makeCliSandbox();
  });

  afterAll(() => {
    cli.cleanup();
  });

  it.each([
    [["devices", "list"], "devices.list"],
    [["credentials", "sync", "pull"], "credentials.sync.pull"],
    [["app-store", "rollout", "start"], "app-store.rollout.start"],
  ])("%j resolves to %s", async (args, command) => {
    const result = await cli.run(["--json", ...args]);
    expect(parseEnvelope(result.stdout).command).toBe(command);
  });

  it("a trailing positional (an id) is never folded into the command name", async () => {
    const result = await cli.run(["--json", "branches", "view", "bch_123"]);
    expect(parseErrorEnvelope(result.stdout)).toMatchObject({
      command: "branches.view",
      error: { code: 3, tag: "AuthRequiredError" },
    });
  });

  it("default subcommands report the parent path (`org`, `credentials`, `credentials account`)", async () => {
    for (const [args, command] of [
      [["org"], "org"],
      [["credentials"], "credentials"],
      [["credentials", "account"], "credentials.account"],
    ] as const) {
      const result = await cli.run(["--json", ...args]);
      expectIs(args.join(" "), result.exitCode, 3);
      expectIs(args.join(" "), parseErrorEnvelope(result.stdout).command, command);
    }
  });

  it("the error envelope carries code/tag/message and the exit code equals the code", async () => {
    const result = await cli.run(["--json", "whoami"]);
    expect(result.exitCode).toBe(3);
    expect(parseErrorEnvelope(result.stdout)).toStrictEqual({
      schemaVersion: 1,
      ok: false,
      command: "whoami",
      error: {
        code: 3,
        tag: "AuthRequiredError",
        message: "Not logged in. Run `better-update login` to authenticate.",
      },
    });
  });

  it("a success envelope wraps the command's return value (logout without a session)", async () => {
    const result = await cli.run(["--json", "logout"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(parseEnvelope(result.stdout)).toStrictEqual({
      schemaVersion: 1,
      ok: true,
      command: "logout",
      data: { loggedOut: true, clearedAppleSession: false },
    });
  });

  it("base policy: InteractiveProhibitedError exits 2", async () => {
    const result = await cli.run(["--json", "credentials", "identity", "create"]);
    expect(result.exitCode).toBe(2);
    expect(parseErrorEnvelope(result.stdout).error).toMatchObject({
      code: 2,
      tag: "InteractiveProhibitedError",
    });
  });

  it("apple-portal override: InteractiveProhibitedError exits 4 under `apple login`", async () => {
    const result = await cli.run(["--json", "apple", "login"]);
    expect(result.exitCode).toBe(4);
    expect(parseErrorEnvelope(result.stdout).error).toMatchObject({
      code: 4,
      tag: "InteractiveProhibitedError",
    });
  });

  it("apple-portal override also covers nested groups (`apple sandbox create`)", async () => {
    const result = await cli.run(
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
    expect(result.exitCode).toBe(4);
    expect(parseErrorEnvelope(result.stdout).error.tag).toBe("InteractiveProhibitedError");
  });

  it("validation errors exit 2 with their own tag (fingerprint compare with nothing to compare)", async () => {
    const result = await cli.run(["--json", "fingerprint", "compare"]);
    expect(result.exitCode).toBe(2);
    expect(parseErrorEnvelope(result.stdout).error).toMatchObject({
      code: 2,
      tag: "FingerprintError",
    });
  });

  it("project-not-linked exits 4 (`env exec` in an empty directory)", async () => {
    const result = await cli.run(["--json", "env", "exec", "production", "--", "true"]);
    expect(result.exitCode).toBe(4);
    expect(parseErrorEnvelope(result.stdout).error).toMatchObject({
      code: 4,
      tag: "ProjectNotLinkedError",
    });
  });

  it("a handler's early validation failure is an envelope, never a silent exit 0 (`submit`)", async () => {
    const result = await cli.run(["--json", "submit", "--platform", "ios"]);
    expect(result.exitCode).not.toBe(0);
    expect(parseErrorEnvelope(result.stdout).command).toBe("submit");
  });
});
