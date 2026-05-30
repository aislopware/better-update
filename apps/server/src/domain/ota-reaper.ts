import type { ParsedPatchKey } from "../lib/patch-key";

/**
 * Pure inputs the patch-reap decision needs for one R2 patch object. The
 * imperative shell (application/ota-reaper.ts) gathers the cross-reference sets
 * via repositories and feeds them in; this predicate makes the keep/reap call
 * with no I/O.
 */
export interface PatchReapInput {
  /** When the patch blob was uploaded to R2 (ISO 8601). */
  readonly uploadedAt: string;
  /** Parsed patch identity, or null if the key is malformed orphan junk. */
  readonly parsed: ParsedPatchKey | null;
  /** Whether the patch `to` id is still a surviving update (project scope). */
  readonly toSurvives: boolean;
  /** Whether the patch `from` id is still a surviving update (project scope). */
  readonly fromSurvives: boolean;
  /**
   * Whether the patch `from` id is still a valid base a supported-window device
   * may patch from (recent non-rollback launch-asset update OR embedded
   * baseline), unioned across the project's branches for that (rv, platform).
   */
  readonly fromIsValidBase: boolean;
  /** PATCH_RETENTION cutoff (ISO 8601). uploadedAt < cutoff => beyond TTL. */
  readonly cutoff: string;
}

/**
 * Conservative patch-blob reap predicate. A patch is reap-eligible iff it is
 * BOTH beyond the retention TTL AND no longer reachable:
 *
 *   1. TTL gate (first, always): uploadedAt must be strictly older than the
 *      PATCH_RETENTION cutoff. Anything within the window is KEPT regardless of
 *      cross-ref — a stale-but-supported device may still patch from a base
 *      whose `to` was just reaped, so the TTL bounds when we let go.
 *   2. Reachability: beyond the TTL, reap only on unambiguous absence —
 *      a malformed key (orphan junk), OR the `to` id no longer survives, OR the
 *      `from` id no longer survives, OR the `from` is no longer a valid base.
 *
 * A patch with a valid base + surviving target + within TTL is always KEPT
 * (keep-when-in-doubt). Patches are regenerable from base+target bundles, so a
 * missed keep is recoverable, but the predicate still errs toward keep.
 */
export const isPatchReapEligible = (input: PatchReapInput): boolean => {
  // TTL gate first: never reap a patch still inside the retention window.
  if (input.uploadedAt >= input.cutoff) {
    return false;
  }

  // Malformed/orphan keys past the TTL are always reapable junk.
  if (input.parsed === null) {
    return true;
  }

  // Beyond the TTL: reap only when the patch is provably unreachable.
  return !input.toSurvives || !input.fromSurvives || !input.fromIsValidBase;
};
