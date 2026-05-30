import type { PatchBaseCandidate } from "@better-update/api";

// Pure base-window selection for the CLI patch pipeline. No I/O, no Effect — the
// orchestrator (update-publish.ts) feeds the server's listPatchBases result in
// and iterates the returned, bounded list.

export interface SelectBaseWindowParams {
  /** The update just created; never patched against itself. */
  readonly newUpdateId: string;
  /** Max number of *recent* (non-embedded) bases to diff against. */
  readonly maxRecent: number;
}

const compareStringsAsc = (left: string, right: string): number => {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
};

const byCreatedAtDesc = (left: PatchBaseCandidate, right: PatchBaseCandidate): number => {
  // ISO-8601 timestamps sort lexicographically; fall back to updateId for a
  // stable, deterministic order when two updates share a createdAt.
  if (left.createdAt === right.createdAt) {
    return compareStringsAsc(left.updateId, right.updateId);
  }
  return compareStringsAsc(right.createdAt, left.createdAt);
};

/**
 * Choose the bounded set of base updates a new bundle should be diffed against.
 *
 * Rules (all pure + deterministic):
 *  - drop any candidate equal to `newUpdateId` (a self-patch is meaningless),
 *  - drop any candidate missing a launch-asset hash (nothing to fetch/diff),
 *  - dedup by `updateId` (the server merges recent + embedded; ids can overlap),
 *  - sort newest-first by `createdAt` (tie-break on `updateId`),
 *  - keep at most `maxRecent` *non-embedded* bases,
 *  - ALWAYS include the embedded baseline(s) even when they fall outside the
 *    recent window, so first-launch (embedded -> latest) patches are produced.
 *
 * Returns the ordered list the orchestrator iterates. Embedded baselines are
 * appended after the recent window (they are the rarest hit but must exist).
 */
export const selectBaseWindow = (
  candidates: readonly PatchBaseCandidate[],
  params: SelectBaseWindowParams,
): readonly PatchBaseCandidate[] => {
  const target = params.newUpdateId.toLowerCase();
  const maxRecent = Math.max(0, Math.trunc(params.maxRecent));

  const seen = new Set<string>();
  const eligible = candidates.filter((candidate) => {
    const updateId = candidate.updateId.toLowerCase();
    if (updateId === target || candidate.launchAssetHash.length === 0 || seen.has(updateId)) {
      return false;
    }
    seen.add(updateId);
    return true;
  });

  const sorted = [...eligible].toSorted(byCreatedAtDesc);
  const embedded = sorted.filter((candidate) => candidate.isEmbedded);
  const recent = sorted.filter((candidate) => !candidate.isEmbedded).slice(0, maxRecent);

  // Recent first, then any embedded baseline not already in the recent slice.
  const recentIds = new Set(recent.map((candidate) => candidate.updateId.toLowerCase()));
  const extraEmbedded = embedded.filter(
    (candidate) => !recentIds.has(candidate.updateId.toLowerCase()),
  );
  return [...recent, ...extraEmbedded];
};
