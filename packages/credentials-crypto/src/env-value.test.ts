import { fromBase64, toBase64 } from "@better-update/encoding";

import { openEnvValue, sealEnvValue } from "./env-value";

const vaultKey = new Uint8Array(32).fill(7);
const otherKey = new Uint8Array(32).fill(9);

const seal = (overrides?: { vaultKind?: "credentials" | "env"; value?: string }) =>
  sealEnvValue({
    vaultKey,
    vaultVersion: 1,
    vaultKind: overrides?.vaultKind ?? "env",
    orgId: "org-1",
    key: "API_TOKEN",
    environment: "production",
    value: overrides?.value ?? "s3cr3t-value",
  });

const open = (
  env: ReturnType<typeof seal>,
  overrides?: { vaultKey?: Uint8Array; vaultKind?: "credentials" | "env" },
) =>
  openEnvValue({
    vaultKey: overrides?.vaultKey ?? vaultKey,
    orgId: "org-1",
    credentialId: env.id,
    ciphertext: env.ciphertext,
    wrappedDek: env.wrappedDek,
    vaultVersion: env.vaultVersion,
    vaultKind: overrides?.vaultKind ?? env.vaultKind,
  });

describe("env-value seal/open", () => {
  it("round-trips an env value and its metadata under the env vault", () => {
    const env = seal();
    expect(env.vaultKind).toBe("env");
    const opened = open(env);
    expect(opened.value).toBe("s3cr3t-value");
    expect(opened.key).toBe("API_TOKEN");
    expect(opened.environment).toBe("production");
  });

  it("round-trips under the credentials vault (pre-cutover path)", () => {
    const env = seal({ vaultKind: "credentials" });
    expect(open(env).value).toBe("s3cr3t-value");
  });

  it("rejects a cross-vault open (env wrap opened as credentials)", () => {
    const env = seal({ vaultKind: "env" });
    expect(() => open(env, { vaultKind: "credentials" })).toThrow(Error);
  });

  it("rejects the wrong vault key", () => {
    const env = seal();
    expect(() => open(env, { vaultKey: otherKey })).toThrow(Error);
  });

  it("rejects a tampered ciphertext", () => {
    const env = seal();
    const bytes = fromBase64(env.ciphertext);
    const tampered = Uint8Array.from(bytes, (byte, index) =>
      index === 0 ? (byte + 1) % 256 : byte,
    );
    expect(() => open({ ...env, ciphertext: toBase64(tampered) })).toThrow(Error);
  });

  it("rejects a credential-id swap (wrap bound to a different id)", () => {
    const env = seal();
    expect(() =>
      openEnvValue({
        vaultKey,
        orgId: "org-1",
        credentialId: "different-id",
        ciphertext: env.ciphertext,
        wrappedDek: env.wrappedDek,
        vaultVersion: env.vaultVersion,
        vaultKind: env.vaultKind,
      }),
    ).toThrow(Error);
  });
});
