import { generateAccountKey, sealAccountKey } from "@better-update/credentials-crypto";

import { openAccountKeyOffMainThread, sealAccountKeyOffMainThread } from "./account-key";

import type { AccountKeyRequest, AccountKeyResponse } from "./account-key-worker";

// The unit project runs in Node, where `Worker` is undefined — the module's
// main-thread fallback. Each worker-path test installs a fake `Worker` for the
// duration of the test; the crypto itself is real, with light Argon2 params so the
// fallback derives its KEK in milliseconds.
const TEST_KDF = { time: 1, memory: 64, parallelism: 1 };
const PASSPHRASE = "correct horse battery staple";

interface FakeWorker {
  readonly received: AccountKeyRequest[];
  readonly terminated: () => boolean;
}

/** Install a `Worker` that answers every request with `reply`, or fails as `mode` says. */
const installFakeWorker = (
  mode: "reply" | "error" | "construct-throws",
  reply?: AccountKeyResponse,
): FakeWorker => {
  const received: AccountKeyRequest[] = [];
  const terminatedFlag = { value: false };
  class StubWorker {
    private readonly listeners = new Map<string, (event: unknown) => void>();
    public constructor() {
      if (mode === "construct-throws") {
        // Stands in for a browser refusing to construct the worker (e.g. CSP).
        throw new Error("worker blocked");
      }
    }
    public readonly addEventListener = (type: string, listener: (event: unknown) => void): void => {
      this.listeners.set(type, listener);
    };
    public readonly postMessage = (request: AccountKeyRequest): void => {
      received.push(request);
      setTimeout(() => {
        if (mode === "error") {
          this.listeners.get("error")?.({});
          return;
        }
        this.listeners.get("message")?.({ data: reply });
      }, 0);
    };
    public readonly terminate = (): void => {
      terminatedFlag.value = true;
      this.listeners.clear();
    };
  }
  vi.stubGlobal("Worker", StubWorker);
  return { received, terminated: () => terminatedFlag.value };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("running the account-key ceremony off the main thread", () => {
  it("returns the worker's result and terminates it", async () => {
    const material = await generateAccountKey();
    const worker = installFakeWorker("reply", { ok: true, op: "open", material });

    const opened = await openAccountKeyOffMainThread({
      envelope: {
        version: 1,
        agePublicKey: material.agePublicKey,
        ed25519PublicKey: material.ed25519PublicKey,
        fingerprint: material.fingerprint,
        kdf: "argon2id",
        kdfParams: TEST_KDF,
        salt: "c2FsdA==",
        cipher: "xchacha20poly1305",
        ct: "Y3Q=",
      },
      passphrase: PASSPHRASE,
    });

    expect(opened).toStrictEqual(material);
    expect(worker.received[0]?.op).toBe("open");
    expect(worker.terminated()).toBe(true);
  });

  it("rejects with the worker's crypto failure instead of falling back", async () => {
    const material = await generateAccountKey();
    installFakeWorker("reply", { ok: false, message: "invalid tag" });

    await expect(sealAccountKeyOffMainThread({ material, passphrase: PASSPHRASE })).rejects.toThrow(
      "invalid tag",
    );
  });

  it("falls back to the main thread when the worker cannot be constructed", async () => {
    const material = await generateAccountKey();
    const envelope = sealAccountKey({ material, passphrase: PASSPHRASE, kdfParams: TEST_KDF });
    installFakeWorker("construct-throws");

    const opened = await openAccountKeyOffMainThread({ envelope, passphrase: PASSPHRASE });

    expect(opened.agePrivateKey).toBe(material.agePrivateKey);
  });

  it("falls back to the main thread when the worker fails to load", async () => {
    const material = await generateAccountKey();
    const envelope = sealAccountKey({ material, passphrase: PASSPHRASE, kdfParams: TEST_KDF });
    const worker = installFakeWorker("error");

    const opened = await openAccountKeyOffMainThread({ envelope, passphrase: PASSPHRASE });

    expect(opened.agePrivateKey).toBe(material.agePrivateKey);
    expect(worker.terminated()).toBe(true);
  });
});
