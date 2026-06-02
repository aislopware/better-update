// Workers-compatible password hashing (PBKDF2 via Web Crypto). Better Auth's
// default scrypt (N:16384, r:16) needs ~64 MB and crashes workerd, so we swap in
// PBKDF2-SHA256 for the email/password path (test mode only).

import { fromHex, toHex } from "@better-update/encoding";

const PBKDF2_ITERATIONS = 600_000;
const HEX_BYTES_PATTERN = /^(?:[0-9A-Fa-f]{2})+$/u;

const deriveKey = async (password: string, salt: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer> => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    256,
  );
};

export const hashPassword = async (password: string): Promise<string> => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = new Uint8Array(await deriveKey(password, salt));
  return `${toHex(salt)}:${toHex(derived)}`;
};

export const verifyPassword = async ({
  hash,
  password,
}: {
  hash: string;
  password: string;
}): Promise<boolean> => {
  const [saltHex, keyHex] = hash.split(":");
  if (!saltHex || !keyHex || !HEX_BYTES_PATTERN.test(saltHex) || !HEX_BYTES_PATTERN.test(keyHex)) {
    return false;
  }
  const derived = new Uint8Array(await deriveKey(password, fromHex(saltHex)));
  const expected = fromHex(keyHex);
  if (derived.length !== expected.length) {
    return false;
  }
  // Constant-time comparison — reduce with XOR to avoid timing side-channels
  // eslint-disable-next-line no-bitwise -- intentional constant-time XOR comparison
  const result = derived.reduce((acc, byte, idx) => acc | (byte ^ (expected.at(idx) ?? 0)), 0);
  return result === 0;
};
