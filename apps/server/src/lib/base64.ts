const asUint8Array = (data: Uint8Array | ArrayBuffer): Uint8Array =>
  data instanceof Uint8Array ? data : new Uint8Array(data);

const toBinaryString = (data: Uint8Array | ArrayBuffer): string =>
  [...asUint8Array(data)].map((byte) => String.fromCodePoint(byte)).join("");

const padBase64 = (value: string): string =>
  value.padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");

export const toBase64 = (data: Uint8Array | ArrayBuffer): string => btoa(toBinaryString(data));

export const fromBase64 = (str: string): Uint8Array => {
  const binary = atob(str);
  return new Uint8Array(
    Array.from({ length: binary.length }, (_, idx) => binary.codePointAt(idx) ?? 0),
  );
};

export const toBase64Url = (data: Uint8Array | ArrayBuffer): string =>
  toBase64(data).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");

export const fromBase64Url = (str: string): Uint8Array =>
  fromBase64(padBase64(str.replaceAll("-", "+").replaceAll("_", "/")));
