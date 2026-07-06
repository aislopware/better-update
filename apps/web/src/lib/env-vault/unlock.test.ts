import {
  generateAccountKey,
  generateIdentity,
  generateVaultKey,
  sealAccountKey,
  wrapVaultKey,
} from "@better-update/credentials-crypto";
import { toBase64 } from "@better-update/encoding";

import { unlockEnvVault } from "./unlock";

// Stub the two API bindings behind hoisted state so each test controls what the
// server "returns"; the crypto itself is real (a wrong passphrase must fail the
// actual AEAD open for the remapping to be exercised).
const { apiModule, state } = vi.hoisted(() => {
  const hoistedState: {
    escrow: unknown;
    wrap: { envVaultVersion: number; wrappedKey: string } | null;
  } = { escrow: null, wrap: null };
  return { apiModule: "@better-update/api-client/react", state: hoistedState };
});

vi.mock(apiModule, () => ({
  getAccountKeyEscrow: async () => state.escrow,
  getEnvVaultAccountWrap: async () => state.wrap,
}));

/** Light Argon2 params so each test derives its KEK in milliseconds, not seconds. */
const TEST_KDF = { time: 1, memory: 64, parallelism: 1 };
const PASSPHRASE = "correct horse battery staple";

const enrollEscrow = async () => {
  const material = await generateAccountKey();
  const envelope = sealAccountKey({ material, passphrase: PASSPHRASE, kdfParams: TEST_KDF });
  state.escrow = {
    ...envelope,
    id: "acct-1",
    escrowCt: envelope.ct,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  return material;
};

describe("unlocking the env vault in the browser", () => {
  it("remaps a wrong passphrase to an actionable message, not the raw AEAD error", async () => {
    await enrollEscrow();
    await expect(unlockEnvVault("org-1", "not the passphrase")).rejects.toThrow(
      /wrong passphrase/i,
    );
    await expect(unlockEnvVault("org-1", "not the passphrase")).rejects.not.toThrow(/invalid tag/);
  });

  it("remaps a wrap this account key cannot open to the re-grant hint", async () => {
    await enrollEscrow();
    const stranger = await generateIdentity();
    const wrapped = await wrapVaultKey({
      vaultKey: generateVaultKey(),
      recipient: stranger.publicKey,
    });
    state.wrap = { envVaultVersion: 4, wrappedKey: toBase64(wrapped) };
    await expect(unlockEnvVault("org-1", PASSPHRASE)).rejects.toThrow(/re-grant env access/i);
  });

  it("unlocks with the right passphrase and a wrap to this account key", async () => {
    const material = await enrollEscrow();
    const envKey = generateVaultKey();
    const wrapped = await wrapVaultKey({ vaultKey: envKey, recipient: material.agePublicKey });
    state.wrap = { envVaultVersion: 5, wrappedKey: toBase64(wrapped) };
    const unlocked = await unlockEnvVault("org-1", PASSPHRASE);
    expect(unlocked.envVaultVersion).toBe(5);
    expect(unlocked.vaultKey).toStrictEqual(envKey);
  });
});
