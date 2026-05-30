import { parseDictionary, serializeDictionary } from "structured-headers";

import type { Dictionary, InnerList, Item } from "structured-headers";

// Pure Expo code-signing Structured Field Values (SFV) helpers. NO crypto here:
// this package only formats/parses the `expo-signature` and
// `expo-expect-signature` SFV dictionaries and slices PEM blocks. Actual signing
// uses node:crypto in the CLI adapter; verification goes through the server's
// CryptoService port. Reuse `structured-headers` (already a server dep) — do NOT
// hand-roll SFV.
//
// Every function is a TOTAL sync function that mirrors protocol/sfv.ts's
// safe-wrapper style: the parse helpers convert structured-headers' throwing
// behaviour into a typed failure value, so a malformed wire string can never
// throw into an Effect defect.

/**
 * The ONLY code-signing algorithm Expo SDK 56 verifies: RSASSA-PKCS1-v1_5 with
 * SHA-256. ECDSA is intentionally NOT supported — the server rejects any other
 * `alg` at publish time, gating it off the wire.
 */
export const CODE_SIGNING_ALG = "rsa-v1_5-sha256";

/**
 * Serialize the `expo-signature` SFV dictionary the device parses. Emits exactly
 * `sig="<base64>", keyid="<id>", alg="rsa-v1_5-sha256"`. `alg` defaults to
 * {@link CODE_SIGNING_ALG} (the only value SDK56 verifies).
 */
export const buildExpoSignatureHeader = (params: {
  readonly sig: string;
  readonly keyid: string;
  readonly alg?: string;
}): string =>
  serializeDictionary(
    new Map<string, Item>([
      ["sig", [params.sig, new Map()]],
      ["keyid", [params.keyid, new Map()]],
      ["alg", [params.alg ?? CODE_SIGNING_ALG, new Map()]],
    ]),
  );

/**
 * A parsed `expo-signature` dictionary: a required base64 `sig` plus optional
 * `keyid` / `alg`. `alg` is intentionally NOT defaulted here — the caller
 * (server verifier) decides how an absent alg is treated, mirroring the device's
 * `parseFromString(null) => RSA_SHA256` default.
 */
export interface ParsedExpoSignature {
  readonly sig: string;
  readonly keyid?: string;
  readonly alg?: string;
}

/**
 * A typed failure returned (never thrown) when an SFV signature string is not a
 * valid dictionary carrying a string `sig`.
 */
export interface ParseFailure {
  readonly ok: false;
  readonly reason: string;
}

// Only ParseFailure carries an `ok` discriminant; a parsed signature never does.
const isParseFailure = (value: ParsedExpoSignature | ParseFailure): value is ParseFailure =>
  "ok" in value;

const parseDictionarySafe = (raw: string): Dictionary | undefined => {
  // eslint-disable-next-line functional/no-try-statements -- structured-headers parseDictionary throws ParseError on malformed input; convert to undefined so a bad signature string degrades to a typed failure rather than throwing into an Effect defect
  try {
    return parseDictionary(raw);
  } catch {
    return undefined;
  }
};

// An SFV dictionary member is `[BareItem, Parameters]` (an Item) or an InnerList
// (`[Item[], Parameters]` whose first element is an array of Items). A string
// value is the BareItem at index 0 not being an array and being a string.
const stringItemValue = (member: Item | InnerList): string | undefined => {
  const [value] = member;
  return typeof value === "string" ? value : undefined;
};

/**
 * Parse the `expo-signature` SFV dictionary. Returns a {@link ParsedExpoSignature}
 * (string `sig` required; optional `keyid` / `alg`) or a typed {@link ParseFailure}
 * — TOTAL, never throws.
 */
export const parseExpoSignatureHeader = (raw: string): ParsedExpoSignature | ParseFailure => {
  const dict = parseDictionarySafe(raw);
  if (dict === undefined) {
    return { ok: false, reason: "signature is not a valid SFV dictionary" } as const;
  }
  const sigMember = dict.get("sig");
  const sig = sigMember === undefined ? undefined : stringItemValue(sigMember);
  if (sig === undefined) {
    return { ok: false, reason: "signature dictionary is missing a string `sig` member" } as const;
  }
  const keyidMember = dict.get("keyid");
  const algMember = dict.get("alg");
  const keyid = keyidMember === undefined ? undefined : stringItemValue(keyidMember);
  const alg = algMember === undefined ? undefined : stringItemValue(algMember);
  return {
    sig,
    ...(keyid === undefined ? {} : { keyid }),
    ...(alg === undefined ? {} : { alg }),
  };
};

export const isExpoSignatureParseFailure = isParseFailure;

/**
 * Parse the inbound `expo-expect-signature` SFV dictionary to read the requested
 * `keyid` / `alg`. The device sends `sig` as a bare token (no value) here, so we
 * only pull `keyid` / `alg`. TOTAL — a malformed header yields `{}`.
 */
export const parseExpectSignatureHeader = (
  raw: string,
): { readonly keyid?: string; readonly alg?: string } => {
  const dict = parseDictionarySafe(raw);
  if (dict === undefined) {
    return {};
  }
  const keyidMember = dict.get("keyid");
  const algMember = dict.get("alg");
  const keyid = keyidMember === undefined ? undefined : stringItemValue(keyidMember);
  const alg = algMember === undefined ? undefined : stringItemValue(algMember);
  return {
    ...(keyid === undefined ? {} : { keyid }),
    ...(alg === undefined ? {} : { alg }),
  };
};

const CERT_BEGIN = "-----BEGIN CERTIFICATE-----";
const CERT_END = "-----END CERTIFICATE-----";

/**
 * Extract the LEAF certificate (first `-----BEGIN CERTIFICATE----- … -----END
 * CERTIFICATE-----` block) from a PEM chain. Expo orders the chain leaf-first,
 * and the leaf carries the code-signing public key the device verifies against.
 * Returns `undefined` when no complete certificate block is present.
 */
export const extractLeafCertificatePem = (chainPem: string): string | undefined => {
  const start = chainPem.indexOf(CERT_BEGIN);
  if (start === -1) {
    return undefined;
  }
  const endMarker = chainPem.indexOf(CERT_END, start);
  if (endMarker === -1) {
    return undefined;
  }
  return chainPem.slice(start, endMarker + CERT_END.length);
};
