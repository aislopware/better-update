import { fromBase64 } from "@better-update/encoding";

const PEM_HEADER = "-----BEGIN PRIVATE KEY-----";
const PEM_FOOTER = "-----END PRIVATE KEY-----";

/** Extract the PKCS8 DER bytes from an Apple `.p8` PEM-encoded private key. */
export const pemToPkcs8Der = (pem: string): Uint8Array | null => {
  const normalized = pem.replaceAll("\r\n", "\n").trim();
  const start = normalized.indexOf(PEM_HEADER);
  const end = normalized.indexOf(PEM_FOOTER);
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  const body = normalized
    .slice(start + PEM_HEADER.length, end)
    .replaceAll(/\s+/g, "")
    .trim();
  if (body.length === 0) {
    return null;
  }
  // eslint-disable-next-line functional/no-try-statements -- PEM parsing is a pure validation boundary; invalid base64 should return null, not escape as a defect
  try {
    return fromBase64(body);
  } catch {
    return null;
  }
};
