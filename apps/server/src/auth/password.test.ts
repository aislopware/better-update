import { hashPassword, verifyPassword } from "./password";

describe("password hashing (PBKDF2)", () => {
  it("verifies a correct password against its hash", async () => {
    const hash = await hashPassword("SecureP@ss123");
    expect(hash).toMatch(/^[0-9a-f]+:[0-9a-f]+$/u);
    await expect(verifyPassword({ hash, password: "SecureP@ss123" })).resolves.toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("SecureP@ss123");
    await expect(verifyPassword({ hash, password: "wrong-password" })).resolves.toBe(false);
  });

  it("uses a random salt so hashes differ for the same password", async () => {
    const first = await hashPassword("same-password");
    const second = await hashPassword("same-password");
    expect(first).not.toBe(second);
    await expect(verifyPassword({ hash: first, password: "same-password" })).resolves.toBe(true);
    await expect(verifyPassword({ hash: second, password: "same-password" })).resolves.toBe(true);
  });

  it("returns false for a malformed hash", async () => {
    await expect(verifyPassword({ hash: "not-a-valid-hash", password: "x" })).resolves.toBe(false);
    await expect(verifyPassword({ hash: "zz:zz", password: "x" })).resolves.toBe(false);
    await expect(verifyPassword({ hash: "", password: "x" })).resolves.toBe(false);
  });
});
