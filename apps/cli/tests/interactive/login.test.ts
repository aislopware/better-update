import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { spawnPty } from "../helpers/pty-driver";

const CLI_ENTRY = path.resolve(import.meta.dirname, "../../src/index.ts");

describe("login --api-key (interactive PoC)", () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(path.join(os.tmpdir(), "better-update-pty-home-"));
  });

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
  });

  test("prompts for API key, stores token on enter", async () => {
    const driver = spawnPty("bun", [CLI_ENTRY, "login", "--api-key"], {
      env: {
        HOME: homeDir,
        FORCE_COLOR: "0",
        NO_COLOR: "1",
        // Layer construction currently yields apiClient eagerly via UpdateAssetUploaderLive,
        // So every CLI invocation resolves a token. Pass a placeholder — login still writes
        // The prompted token to auth.json, which is what we assert.
        BETTER_UPDATE_TOKEN: "startup-placeholder",
      },
    });

    await driver.expect(/Paste your API key/, { timeoutMs: 15_000 });

    driver.send("pk_test_abc123");
    driver.enter();

    await driver.expect("Logged in successfully", { timeoutMs: 10_000 });
    const code = await driver.waitExit({ timeoutMs: 5000 });
    expect(code).toBe(0);

    const authJson = JSON.parse(
      readFileSync(path.join(homeDir, ".better-update/auth.json"), "utf8"),
    ) as { token: string };
    expect(authJson.token).toBe("pk_test_abc123");
  });
});
