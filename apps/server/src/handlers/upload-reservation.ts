import { fromHex, toBase64 } from "@better-update/encoding";
import { Effect, Schema } from "effect";

import { BadRequest } from "../errors";

// Shared reserve → presigned PUT → complete machinery for every direct-upload
// handler (build artifacts, build debug artifacts, update sourcemaps). The
// timing constants and the reservation trust model (R2 enforces the reserved
// x-amz-checksum-sha256 on the presigned PUT, so a successful upload already
// proves the stored bytes) must stay identical across all three flows.

export const UPLOAD_EXPIRY_SECONDS = 7200;
export const KV_RESERVATION_TTL = 10_800;
export const DOWNLOAD_EXPIRY_SECONDS = 900;

export const uploadExpiresAtIso = () =>
  new Date(Date.now() + UPLOAD_EXPIRY_SECONDS * 1000).toISOString();

export const downloadExpiresAtIso = () =>
  new Date(Date.now() + DOWNLOAD_EXPIRY_SECONDS * 1000).toISOString();

/** `label` is the error-message subject, e.g. "Build" → "Build SHA-256 must be valid hex". */
export const sha256HexToBase64 = (sha256: string, label: string) =>
  Effect.try({
    try: () => toBase64(fromHex(sha256)),
    catch: () => new BadRequest({ message: `${label} SHA-256 must be valid hex` }),
  });

/**
 * Parse + schema-decode a KV reservation payload. `label` is the message
 * subject, e.g. "Sourcemap reservation" → "Sourcemap reservation is not valid
 * JSON" / "… failed schema decode".
 */
export const parseReservation = <Decoded, Encoded>(
  json: string,
  schema: Schema.Schema<Decoded, Encoded>,
  label: string,
): Effect.Effect<Decoded, BadRequest> =>
  Effect.gen(function* () {
    const raw = yield* Effect.try({
      try: () => JSON.parse(json) as unknown,
      catch: () => new BadRequest({ message: `${label} is not valid JSON` }),
    });
    return yield* Schema.decodeUnknown(schema)(raw).pipe(
      Effect.mapError(() => new BadRequest({ message: `${label} failed schema decode` })),
    );
  });

/** The completion payload must restate exactly what was reserved. */
export const completionMatchesReservation = (
  payload: { readonly sha256: string; readonly byteSize: number },
  reservation: { readonly sha256: string; readonly byteSize: number },
): boolean =>
  payload.sha256.toLowerCase() === reservation.sha256 && payload.byteSize === reservation.byteSize;
