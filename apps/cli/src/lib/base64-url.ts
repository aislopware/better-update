export const toBase64Url = (data: Buffer | Uint8Array | ArrayBuffer): string =>
  Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
