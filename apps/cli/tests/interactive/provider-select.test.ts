import path from "node:path";

import { spawnPty } from "../helpers/pty-driver";

const HARNESS = path.resolve(import.meta.dirname, "./harness/provider-prompt.ts");

const RESULT_RE = /^RESULT=(\{.*\})$/m;

const runHarness = async (actions: (driver: ReturnType<typeof spawnPty>) => Promise<void>) => {
  const driver = spawnPty("bun", [HARNESS], {
    env: {
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    },
  });

  await driver.expect("Select App Store Connect provider", { timeoutMs: 15_000 });
  await actions(driver);
  await driver.expect(RESULT_RE, { timeoutMs: 10_000 });
  const code = await driver.waitExit({ timeoutMs: 5000 });
  expect(code).toBe(0);

  const match = RESULT_RE.exec(driver.stripped());
  expect(match, "harness should print RESULT=<json>").not.toBeNull();
  return JSON.parse(match![1]!) as { providerId: number; switched: boolean };
};

describe("provider select prompt (PTY)", () => {
  test("enter without navigation picks the first provider", async () => {
    const result = await runHarness(async (driver) => {
      driver.enter();
    });
    expect(result).toEqual({ providerId: 10, switched: true });
  });

  test("down + enter picks the second provider", async () => {
    const result = await runHarness(async (driver) => {
      driver.down();
      driver.enter();
    });
    expect(result).toEqual({ providerId: 20, switched: true });
  });

  test("down + down + enter picks the third provider", async () => {
    const result = await runHarness(async (driver) => {
      driver.down(2);
      driver.enter();
    });
    expect(result).toEqual({ providerId: 30, switched: true });
  });

  test("up wraps to the last provider", async () => {
    const result = await runHarness(async (driver) => {
      driver.up();
      driver.enter();
    });
    expect(result).toEqual({ providerId: 30, switched: true });
  });
});
