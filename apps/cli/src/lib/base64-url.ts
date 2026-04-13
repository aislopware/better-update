export const toBase64Url = (data: Buffer | Uint8Array | ArrayBuffer): string =>
  Buffer.from(data)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
