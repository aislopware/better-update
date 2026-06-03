import { toBase64Url } from "@better-update/encoding";
import { Data, Effect } from "effect";

import { pemToPkcs8Der } from "./apple-pem";

export class AppleAuthError extends Data.TaggedError("AppleAuthError")<{
  readonly cause: unknown;
}> {}

export interface AscCredentials {
  readonly keyId: string;
  readonly issuerId: string;
  readonly p8Pem: string;
}

const MAX_JWT_LIFETIME_SECONDS = 1200;

const asArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
};

export const signAscJwt = (credentials: AscCredentials) =>
  Effect.gen(function* () {
    const der = pemToPkcs8Der(credentials.p8Pem);
    if (der === null) {
      return yield* new AppleAuthError({ cause: new Error("Invalid .p8 PEM") });
    }

    const header = { alg: "ES256", kid: credentials.keyId, typ: "JWT" };
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: credentials.issuerId,
      iat: now,
      exp: now + MAX_JWT_LIFETIME_SECONDS,
      aud: "appstoreconnect-v1",
    };

    const headerB64 = toBase64Url(new TextEncoder().encode(JSON.stringify(header)));
    const payloadB64 = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
    const signingInput = `${headerB64}.${payloadB64}`;

    const key = yield* Effect.tryPromise({
      try: async () =>
        crypto.subtle.importKey(
          "pkcs8",
          asArrayBuffer(der),
          { name: "ECDSA", namedCurve: "P-256" },
          false,
          ["sign"],
        ),
      catch: (cause) => new AppleAuthError({ cause }),
    });

    const signature = yield* Effect.tryPromise({
      try: async () =>
        crypto.subtle.sign(
          { name: "ECDSA", hash: "SHA-256" },
          key,
          new TextEncoder().encode(signingInput),
        ),
      catch: (cause) => new AppleAuthError({ cause }),
    });

    return `${signingInput}.${toBase64Url(new Uint8Array(signature))}`;
  });
