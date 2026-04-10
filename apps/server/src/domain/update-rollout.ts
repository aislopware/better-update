import { hashToFraction } from "./hash";

// -- Types ------------------------------------------------------------------

interface RolloutCandidate {
  readonly id: string;
  readonly rollout_percentage: number;
}

export type RolloutResolution<T extends RolloutCandidate> =
  | { readonly resolved: true; readonly update: T }
  | { readonly resolved: false; readonly needsFallbackQuery: boolean };

// -- Core -------------------------------------------------------------------

const isInRollout = async (
  updateId: string,
  easClientId: string,
  rolloutPercentage: number,
): Promise<boolean> => {
  const fraction = await hashToFraction(updateId, easClientId);
  return fraction < rolloutPercentage / 100;
};

const evaluateFallback = async <T extends RolloutCandidate>(
  previous: T | undefined,
  easClientId: string | undefined,
): Promise<RolloutResolution<T>> => {
  if (!previous) {
    return { resolved: false, needsFallbackQuery: false };
  }
  if (previous.rollout_percentage === 100) {
    return { resolved: true, update: previous };
  }
  if (previous.rollout_percentage === 0) {
    return { resolved: false, needsFallbackQuery: true };
  }
  // Previous at 1-99% — no client ID means legacy client, serve previous directly
  if (!easClientId) {
    return { resolved: true, update: previous };
  }
  const inRollout = await isInRollout(previous.id, easClientId, previous.rollout_percentage);
  return inRollout
    ? { resolved: true, update: previous }
    : { resolved: false, needsFallbackQuery: true };
};

export const resolveUpdateRollout = async <T extends RolloutCandidate>(
  candidates: readonly T[],
  easClientId?: string,
): Promise<RolloutResolution<T> | null> => {
  const [latest, previous] = candidates;
  if (!latest) {
    return null;
  }

  // Full rollout — serve immediately
  if (latest.rollout_percentage === 100) {
    return { resolved: true, update: latest };
  }

  // Reverted (0%) — skip to previous
  if (latest.rollout_percentage === 0) {
    return evaluateFallback(previous, easClientId);
  }

  // Partial rollout (1-99%)
  if (!easClientId) {
    return evaluateFallback(previous, easClientId);
  }

  const inRollout = await isInRollout(latest.id, easClientId, latest.rollout_percentage);
  if (inRollout) {
    return { resolved: true, update: latest };
  }

  return evaluateFallback(previous, easClientId);
};
