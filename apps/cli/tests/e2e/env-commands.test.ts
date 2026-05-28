import { writeFileSync } from "node:fs";
import path from "node:path";

import { generateIdentity } from "@better-update/credentials-crypto";

import { setupCliE2E } from "../helpers/cli-e2e";

// Env var CLI commands live in their own e2e file (not the big command journey in
// commands.test.ts) so they get a dedicated API key. Every CLI call authenticates
// with it, and the per-key rate limit (120 req / 60s, see apps/server/src/auth.ts)
// would otherwise be shared with — and tipped over by — that long journey.
const cli = setupCliE2E("e2e-cli-env", {
  userEmail: "cli-e2e-env@example.com",
  orgSlug: "cli-e2e-env-org",
});

describe("cLI env var commands", () => {
  // Env var values are sealed under the org vault, so bootstrap an identity +
  // vault once (the CI path: a raw age key via BETTER_UPDATE_IDENTITY), then link
  // the project so the commands can resolve its id.
  let credsEnv: Record<string, string> = {};
  beforeAll(async () => {
    const identity = await generateIdentity();
    credsEnv = { BETTER_UPDATE_IDENTITY: identity.privateKey };

    const init = cli.runCliWithEnv(
      credsEnv,
      "credentials",
      "identity",
      "init",
      "--label",
      "CI Machine",
    );
    expect(init.exitCode).toBe(0);
    expect(init.stdout).toContain("vault bootstrapped");

    const link = cli.runCli("init");
    expect(link.exitCode).toBe(0);
    expect(link.stdout).toContain("Project linked successfully");
  });

  it("pushes a dotenv file to multiple environments, auto-classifying visibility", () => {
    const pushFile = path.join(cli.getProjectDir(), ".env.push");
    writeFileSync(
      pushFile,
      "EXPO_PUBLIC_PUSH_URL=https://push.example.com\nPUSH_SECRET=super-secret\n",
    );

    // Two keys × two environments = 4 upserts. push auto-classifies EXPO_PUBLIC_*
    // as plaintext and everything else as sensitive.
    const pushResult = cli.runCliWithEnv(
      credsEnv,
      "env",
      "push",
      pushFile,
      "--environment",
      "development,preview",
    );
    expect(pushResult.exitCode).toBe(0);
    expect(pushResult.stdout).toContain("Pushed to development,preview");
    expect(pushResult.stdout).toContain("4 created");

    // Metadata lists the auto-classified visibility tiers (no decrypted values).
    const listResult = cli.runCli("env", "list", "--environments", "development");
    expect(listResult.exitCode).toBe(0);
    expect(listResult.stdout).toContain("EXPO_PUBLIC_PUSH_URL");
    expect(listResult.stdout).toContain("plaintext");
    expect(listResult.stdout).toContain("PUSH_SECRET");
    expect(listResult.stdout).toContain("sensitive");

    // pull --stdout decrypts the preview values too — proving the fan-out sealed
    // both environments, including the sensitive (unmasked on pull) entry.
    const pullResult = cli.runCliWithEnv(
      credsEnv,
      "env",
      "pull",
      "--environment",
      "preview",
      "--stdout",
    );
    expect(pullResult.exitCode).toBe(0);
    expect(pullResult.stdout).toContain("export EXPO_PUBLIC_PUSH_URL='https://push.example.com'");
    expect(pullResult.stdout).toContain("export PUSH_SECRET='super-secret'");

    // Re-pushing the same file upserts existing (key, environment) pairs.
    const rePush = cli.runCliWithEnv(
      credsEnv,
      "env",
      "push",
      pushFile,
      "--environment",
      "development,preview",
    );
    expect(rePush.exitCode).toBe(0);
    expect(rePush.stdout).toContain("4 updated");
  });

  it("updates an env var's value and visibility, and rejects an empty update", () => {
    const setResult = cli.runCliWithEnv(
      credsEnv,
      "env",
      "set",
      "UPDATE_ME=v1",
      "--environment",
      "development",
    );
    expect(setResult.exitCode).toBe(0);
    expect(setResult.stdout).toContain("1 created");

    // Change value + visibility in one shot — a new sealed revision.
    const updateBoth = cli.runCliWithEnv(
      credsEnv,
      "env",
      "update",
      "UPDATE_ME",
      "--environment",
      "development",
      "--value",
      "v2",
      "--visibility",
      "sensitive",
    );
    expect(updateBoth.exitCode).toBe(0);
    expect(updateBoth.stdout).toContain("Updated value + visibility for UPDATE_ME (development).");

    // The new value round-trips; sensitive values need --include-sensitive to reveal.
    const getResult = cli.runCliWithEnv(
      credsEnv,
      "env",
      "get",
      "UPDATE_ME",
      "--environment",
      "development",
      "--include-sensitive",
    );
    expect(getResult.exitCode).toBe(0);
    expect(getResult.stdout).toContain("v2");

    // Visibility-only update takes the no-vault path (no resealing needed).
    const updateVisibility = cli.runCli(
      "env",
      "update",
      "UPDATE_ME",
      "--environment",
      "development",
      "--visibility",
      "plaintext",
    );
    expect(updateVisibility.exitCode).toBe(0);
    expect(updateVisibility.stdout).toContain("Updated visibility for UPDATE_ME (development).");

    // Neither --value nor --visibility → argument error (exit 2).
    const noChange = cli.runCli("env", "update", "UPDATE_ME", "--environment", "development");
    expect(noChange.exitCode).toBe(2);
    expect(`${noChange.stdout}${noChange.stderr}`).toContain("Pass --value and/or --visibility");

    // Updating a key that doesn't exist → not found (exit 1).
    const missing = cli.runCli(
      "env",
      "update",
      "DOES_NOT_EXIST",
      "--environment",
      "development",
      "--visibility",
      "plaintext",
    );
    expect(missing.exitCode).toBe(1);
    expect(`${missing.stdout}${missing.stderr}`).toContain("not found");
  });

  it("execs a command with decrypted env vars injected", () => {
    const setResult = cli.runCliWithEnv(
      credsEnv,
      "env",
      "set",
      "EXEC_VAR=hello-exec",
      "--environment",
      "development",
    );
    expect(setResult.exitCode).toBe(0);

    // exec decrypts the project's env vars and injects them into the child process.
    const execResult = cli.runCliWithEnv(
      credsEnv,
      "env",
      "exec",
      "development",
      "--",
      "bun",
      "-e",
      "console.log(process.env.EXEC_VAR ?? 'MISSING')",
    );
    expect(execResult.exitCode).toBe(0);
    expect(execResult.stdout).toContain("hello-exec");

    // The wrapped command's exit code propagates back through the CLI.
    const exitCodeResult = cli.runCliWithEnv(
      credsEnv,
      "env",
      "exec",
      "development",
      "--",
      "bun",
      "-e",
      "process.exit(3)",
    );
    expect(exitCodeResult.exitCode).toBe(3);

    // Omitting the `--` separator is an argument error (exit 2).
    const noCommand = cli.runCli("env", "exec", "development");
    expect(noCommand.exitCode).toBe(2);
    expect(`${noCommand.stdout}${noCommand.stderr}`).toContain("Pass the command after");
  });
});
