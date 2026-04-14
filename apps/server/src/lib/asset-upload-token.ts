import { safeJsonParse } from "@better-update/api";
import { Effect } from "effect";

import { fromBase64Url, toBase64Url } from "./base64";

export interface AssetUploadTokenPayload {
  readonly hash: string;
  readonly expiresAt: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const encodePayload = (payload: AssetUploadTokenPayload) =>
  toBase64Url(encoder.encode(JSON.stringify(payload)));

const decodePayload = (value: string): AssetUploadTokenPayload | null => {
  const decoded = Effect.runSync(
    Effect.orElseSucceed(
      Effect.try({
        try: () => decoder.decode(fromBase64Url(value)),
        catch: () => new Error("Invalid asset upload token payload"),
      }),
      () => null,
    ),
  );
  if (decoded === null) {
    return null;
  }

  const payload = safeJsonParse(decoded);
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const { hash, expiresAt } = payload as {
    readonly hash?: unknown;
    readonly expiresAt?: unknown;
  };

  return typeof hash === "string" && typeof expiresAt === "string" ? { hash, expiresAt } : null;
};

const importSecretKey = async (secret: string) =>
  crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);

const signPayload = async (secret: string, payloadPart: string) => {
  const key = await importSecretKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payloadPart));
  return toBase64Url(new Uint8Array(signature));
};

const timingSafeEquals = (left: string, right: string) => left === right;

export const createAssetUploadToken = async (
  payload: AssetUploadTokenPayload,
  secret: string,
): Promise<string> => {
  const payloadPart = encodePayload(payload);
  const signaturePart = await signPayload(secret, payloadPart);
  return `${payloadPart}.${signaturePart}`;
};

export const verifyAssetUploadToken = async (
  token: string,
  secret: string,
): Promise<AssetUploadTokenPayload | null> => {
  const [payloadPart, signaturePart] = token.split(".");
  if (!payloadPart || !signaturePart) {
    return null;
  }

  const expectedSignature = await signPayload(secret, payloadPart);
  if (!timingSafeEquals(expectedSignature, signaturePart)) {
    return null;
  }

  const payload = decodePayload(payloadPart);
  if (payload === null) {
    return null;
  }

  const expiresAtMs = Date.parse(payload.expiresAt);
  if (Number.isNaN(expiresAtMs) || expiresAtMs <= Date.now()) {
    return null;
  }

  return payload;
};
