import { toBase64 } from "./base64";

export const toChecksumSha256Base64 = (checksums: unknown): string | null => {
  if (typeof checksums !== "object" || checksums === null) {
    return null;
  }

  const { sha256 } = checksums as { readonly sha256?: unknown };
  return sha256 instanceof Uint8Array || sha256 instanceof ArrayBuffer ? toBase64(sha256) : null;
};
