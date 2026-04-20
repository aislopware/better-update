import { Effect } from "effect";

import { CryptoServiceLive } from "../cloudflare/crypto-service";
import { computeDeviceRosterHash } from "./device-roster-hash";

import type { CryptoService } from "./crypto-service";

const run = async <Value>(effect: Effect.Effect<Value, unknown, CryptoService>): Promise<Value> =>
  Effect.runPromise(effect.pipe(Effect.provide(CryptoServiceLive)));

describe("device roster hash", () => {
  test("produces a stable SHA-256 hex for a given device set", async () => {
    const hash = await run(computeDeviceRosterHash(["DEVICE-1", "DEVICE-2"]));
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  test("is order-independent", async () => {
    const [first, second] = await Promise.all([
      run(computeDeviceRosterHash(["a", "b", "c"])),
      run(computeDeviceRosterHash(["c", "a", "b"])),
    ]);
    expect(first).toBe(second);
  });

  test("differs when the roster changes", async () => {
    const [two, three] = await Promise.all([
      run(computeDeviceRosterHash(["x", "y"])),
      run(computeDeviceRosterHash(["x", "y", "z"])),
    ]);
    expect(two).not.toBe(three);
  });

  test("empty roster hashes to the hash of the empty string", async () => {
    const hash = await run(computeDeviceRosterHash([]));
    // SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    expect(hash).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});
