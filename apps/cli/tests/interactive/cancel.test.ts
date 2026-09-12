import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { spawnPty } from "../helpers/pty-driver";

const CLI_ENTRY = path.resolve(import.meta.dirname, "../../dist/index.mjs");

const CTRL_C = "\u0003";

describe("prompt cancellation + interactive override (PTY)", () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(path.join(os.tmpdir(), "better-update-pty-home-"));
  });

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
  });

  const env = () => ({
    HOME: homeDir,
    FORCE_COLOR: "0",
    NO_COLOR: "1",
    BETTER_UPDATE_DISABLE_UPDATE_NOTIFIER: "1",
    BETTER_UPDATE_URL: "http://127.0.0.1:9",
  });

  it("Ctrl-C at a prompt prints the cancellation and exits 130", async () => {
    const driver = spawnPty("node", [CLI_ENTRY, "login", "--api-key"], { env: env() });
    await driver.expect(/Paste your session token/, { timeoutMs: 15_000 });
    driver.send(CTRL_C);
    await driver.expect("Operation cancelled.", { timeoutMs: 10_000 });
    const code = await driver.waitExit({ timeoutMs: 5000 });
    expect(code).toBe(130);
  });

  it("--interactive re-enables prompts under CI", async () => {
    const driver = spawnPty("node", [CLI_ENTRY, "--interactive", "login", "--api-key"], {
      env: { ...env(), CI: "1" },
    });
    await driver.expect(/Paste your session token/, { timeoutMs: 15_000 });
    driver.send(CTRL_C);
    const code = await driver.waitExit({ timeoutMs: 10_000 });
    expect(code).toBe(130);
  });

  it("CI=1 without --interactive refuses the prompt (exit 2)", async () => {
    const driver = spawnPty("node", [CLI_ENTRY, "login", "--api-key"], {
      env: { ...env(), CI: "1" },
    });
    await driver.expect(/requested while running non-interactively/, { timeoutMs: 15_000 });
    const code = await driver.waitExit({ timeoutMs: 5000 });
    expect(code).toBe(2);
  });
});
