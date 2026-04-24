const asUint8Array = (data: Uint8Array | ArrayBuffer): Uint8Array =>
  data instanceof Uint8Array ? data : new Uint8Array(data);

const toBinaryString = (data: Uint8Array | ArrayBuffer): string =>
  Array.from(asUint8Array(data), (byte) => String.fromCodePoint(byte)).join("");

const padBase64 = (value: string): string =>
  value.padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");

const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/u;
const BASE64_URL_PATTERN = /^[A-Za-z0-9_-]*={0,2}$/u;
const HEX_PATTERN = /^(?:[0-9A-Fa-f]{2})*$/u;

const normalizeBase64 = (value: string): string => {
  const compact = value.replaceAll(/\s+/gu, "");
  if (!BASE64_PATTERN.test(compact) || compact.length % 4 === 1) {
    throw new RangeError("Invalid base64 string");
  }
  return padBase64(compact);
};

const normalizeBase64Url = (value: string): string => {
  const compact = value.replaceAll(/\s+/gu, "");
  if (!BASE64_URL_PATTERN.test(compact) || compact.length % 4 === 1) {
    throw new RangeError("Invalid base64url string");
  }
  return compact.replaceAll("-", "+").replaceAll("_", "/");
};

export const toBase64 = (data: Uint8Array | ArrayBuffer): string => btoa(toBinaryString(data));

export const fromBase64 = (str: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(normalizeBase64(str));
  return Uint8Array.from(binary, (char) => char.codePointAt(0) ?? 0);
};

export const toBase64Url = (data: Uint8Array | ArrayBuffer): string =>
  toBase64(data).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");

export const fromBase64Url = (str: string): Uint8Array<ArrayBuffer> =>
  fromBase64(padBase64(normalizeBase64Url(str)));

export const toHex = (bytes: Uint8Array | ArrayBuffer): string =>
  Array.from(asUint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");

export const fromHex = (hex: string): Uint8Array<ArrayBuffer> => {
  if (!HEX_PATTERN.test(hex)) {
    throw new RangeError("Invalid hex string");
  }
  return Uint8Array.from(hex.match(/.{2}/gu) ?? [], (byte) => Number.parseInt(byte, 16));
};
