// 1 hour
const EXPIRY_MS = 3_600_000;

const importKey = async (secret: string) =>
  crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );

const toBase64Url = (buffer: ArrayBuffer) => {
  const binary = [...new Uint8Array(buffer)].map((byte) => String.fromCodePoint(byte)).join("");
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};

const fromBase64Url = (str: string) => {
  const padded = str.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(
    Array.from({ length: binary.length }, (_, idx) => binary.codePointAt(idx) ?? 0),
  );
  return bytes.buffer;
};

export const generateInstallToken = async (buildId: string, secret: string) => {
  const expires = Math.floor((Date.now() + EXPIRY_MS) / 1000);
  const payload = `${buildId}:${expires}`;
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return { token: toBase64Url(signature), expires };
};

export const verifyInstallToken = async (
  buildId: string,
  token: string,
  expires: number,
  secret: string,
) => {
  if (Math.floor(Date.now() / 1000) > expires) {
    return false;
  }
  const payload = `${buildId}:${expires}`;
  const key = await importKey(secret);
  const signatureBytes = fromBase64Url(token);
  return crypto.subtle.verify("HMAC", key, signatureBytes, new TextEncoder().encode(payload));
};
