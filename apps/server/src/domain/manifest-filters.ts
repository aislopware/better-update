// Pure selection-policy core for the expo-updates-1 anti-brick path.
//
// These are pure business rules over update models: total, sync, never throw,
// no Effect needed. `domain/` may import only `effect` + domain types — this
// file needs neither. They power the manifest handler's anti-brick cascade:
//   matchesFilters  — exclude updates whose metadata contradicts a configured
//                     server-policy filter (a direct port of expo's
//                     SelectionPolicies.doesUpdateMatchFilters).
//   skipFailedUpdates — exclude updates the DEVICE just reported as failed so
//                       the server never re-serves a known-bad update.
//
// ANTI-BRICK INVARIANT: both functions can only REMOVE candidates, never add or
// reorder; an empty result is intentional and safe — the caller's existing
// empty-candidates path returns 204 (keep running what you have) and the
// device's own ErrorRecovery falls back to its last-known-good / embedded
// update. Neither function may ever strand by accident: the permissive default
// (undefined filters / undefined metadata => match) guarantees the only updates
// dropped are ones that explicitly contradict a filter or were explicitly
// reported failed.

/**
 * Port of expo `SelectionPolicies.doesUpdateMatchFilters` / `matchesFilters`
 * (SelectionPolicies.kt / SelectionPolicies.swift, sdk-56).
 *
 * - `filters` undefined => `true` (no server policy configured).
 * - `updateMetadata` undefined => `true` (update carries no metadata to test).
 * - The device lowercases ONLY the metadata keys and looks each filter key up
 *   VERBATIM (it does NOT lowercase the filter key). We mirror that exactly: the
 *   filter key is used as-is against the lowercased metadata map. Stored filter
 *   keys are normalized to lowercase at ingest (parseManifestFiltersJson, which
 *   only admits SFV-conformant lowercase keys), so a non-lowercase filter key can
 *   never reach here — and server-side narrowing stays IDENTICAL to the device's
 *   own SelectionPolicies (no divergence where the server excludes an update the
 *   client would have passed, or vice versa).
 *     - metadata lacks the (lowercased) key => passes (no constraint imposed).
 *     - metadata has the key and the value strictly equals `filters[k]` => passes.
 *     - metadata has the key and the value differs => returns `false`.
 * - All keys pass => `true`.
 */
export const matchesFilters = (
  updateMetadata: Record<string, unknown> | undefined,
  filters: Record<string, string> | undefined,
): boolean => {
  if (filters === undefined) {
    return true;
  }
  if (updateMetadata === undefined) {
    return true;
  }
  const metadataByLowerKey = new Map<string, unknown>(
    Object.entries(updateMetadata).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return Object.entries(filters).every(([key, expected]) => {
    if (!metadataByLowerKey.has(key)) {
      return true;
    }
    return metadataByLowerKey.get(key) === expected;
  });
};

/**
 * Remove any candidate whose `id` the device just reported as failed.
 *
 * Order is preserved (the caller already sorted `created_at` DESC). An empty
 * `recentFailedIds` returns the candidates unchanged (identity). The result MAY
 * be empty — that is intentional and safe; the caller's empty-candidates path
 * produces a 204 no-update, never an error and never a served bad update.
 */
export const skipFailedUpdates = <T extends { readonly id: string }>(
  candidates: readonly T[],
  recentFailedIds: readonly string[],
): readonly T[] => {
  if (recentFailedIds.length === 0) {
    return candidates;
  }
  const failed = new Set(recentFailedIds);
  return candidates.filter((candidate) => !failed.has(candidate.id));
};
