import { toBase64 } from "@better-update/encoding";
import { Effect, Schedule } from "effect";

export const toChecksumSha256Base64 = (checksums: unknown): string | null => {
  if (typeof checksums !== "object" || checksums === null) {
    return null;
  }

  const { sha256 } = checksums as { readonly sha256?: unknown };
  return sha256 instanceof Uint8Array || sha256 instanceof ArrayBuffer ? toBase64(sha256) : null;
};

const R2_RETRY_POLICY = Schedule.spaced("500 millis").pipe(Schedule.compose(Schedule.recurs(4)));

export const r2Operation = <Success>(operation: () => Promise<Success>): Effect.Effect<Success> =>
  Effect.tryPromise(operation).pipe(Effect.retry(R2_RETRY_POLICY), Effect.orDie);

// Compensate an R2 put-then-DB-insert sequence: on error, delete the object
// To avoid orphan blobs. The delete is best-effort; its own errors are ignored
// So the caller sees the primary cause.
export const withR2Compensation = <Success, Failure, Requirements>(
  bucket: R2Bucket,
  r2Key: string,
  effect: Effect.Effect<Success, Failure, Requirements>,
): Effect.Effect<Success, Failure, Requirements> =>
  effect.pipe(
    Effect.tapErrorCause(() => r2Operation(async () => bucket.delete(r2Key)).pipe(Effect.ignore)),
  );
