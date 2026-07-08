import { Effect } from "effect";

import { CryptoServiceLive } from "../cloudflare/crypto-service";
import { computeDeviceRosterHash } from "./device-roster-hash";

import type { CryptoService } from "./crypto-service";

const run = async <Value>(effect: Effect.Effect<Value, unknown, CryptoService>): Promise<Value> =>
  Effect.runPromise(effect.pipe(Effect.provide(CryptoServiceLive)));

describe("device roster hash", () => {
  it("produces a stable SHA-256 hex for a given device set", async () => {
    const hash = await run(computeDeviceRosterHash(["DEVICE-1", "DEVICE-2"]));
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is order-independent", async () => {
    const [first, second] = await Promise.all([
      run(computeDeviceRosterHash(["a", "b", "c"])),
      run(computeDeviceRosterHash(["c", "a", "b"])),
    ]);
    expect(first).toBe(second);
  });

  it("normalizes case and whitespace, and collapses duplicate UDIDs", async () => {
    const [canonical, noisy] = await Promise.all([
      run(computeDeviceRosterHash(["00008020-001d09503c68002e"])),
      // Apple can list one physical device several times (re-added after a
      // disable keeps the UDID); duplicates must not change the fingerprint.
      run(
        computeDeviceRosterHash([
          "00008020-001D09503C68002E",
          " 00008020-001d09503c68002e ",
          "00008020-001d09503c68002e",
        ]),
      ),
    ]);
    expect(noisy).toBe(canonical);
  });

  it("differs when the roster changes", async () => {
    const [two, three] = await Promise.all([
      run(computeDeviceRosterHash(["x", "y"])),
      run(computeDeviceRosterHash(["x", "y", "z"])),
    ]);
    expect(two).not.toBe(three);
  });

  it("empty roster hashes to the hash of the empty string", async () => {
    const hash = await run(computeDeviceRosterHash([]));
    // SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    expect(hash).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});
