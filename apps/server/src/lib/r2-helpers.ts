import { toBase64 } from "@better-update/encoding";
import { Effect, Schedule } from "effect";

export const toChecksumSha256Base64 = (checksums: unknown): string | null => {
  if (typeof checksums !== "object" || checksums === null) {
    return null;
  }

  const { sha256 } = checksums as { readonly sha256?: unknown };
  return sha256 instanceof Uint8Array || sha256 instanceof ArrayBuffer ? toBase64(sha256) : null;
};

// v4 replaced `Schedule.compose` with `Schedule.max`, which recurs only while
// EVERY schedule still recurs and waits the longest of their delays: at most 4
// retries, 500 ms apart (`recurs` itself has no delay).
const R2_RETRY_POLICY = Schedule.max([Schedule.spaced("500 millis"), Schedule.recurs(4)]);

export const r2Operation = <Success>(operation: () => Promise<Success>): Effect.Effect<Success> =>
  Effect.tryPromise(operation).pipe(Effect.retry(R2_RETRY_POLICY), Effect.orDie);

// Compensate a put-then-DB-insert sequence: on error, run the compensating
// delete so no orphan object is left behind. The compensation is best-effort;
// its own errors are ignored so the caller sees the primary cause.
export const withR2Compensation = <Success, Failure, Requirements>(
  compensate: Effect.Effect<void>,
  effect: Effect.Effect<Success, Failure, Requirements>,
): Effect.Effect<Success, Failure, Requirements> =>
  effect.pipe(Effect.tapCause(() => compensate.pipe(Effect.ignore)));
