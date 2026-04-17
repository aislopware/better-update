import { Effect } from "effect";

import { CryptoService } from "./crypto-service";

import type { CryptoError } from "./crypto-service";

interface RolloutCandidate {
  readonly id: string;
  readonly rollout_percentage: number;
}

export type RolloutResolution<T extends RolloutCandidate> =
  | { readonly resolved: true; readonly update: T }
  | { readonly resolved: false; readonly needsFallbackQuery: boolean };

export const collectServableUpdates = <T extends RolloutCandidate>(
  candidates: readonly T[],
): readonly T[] => {
  const [candidate, ...rest] = candidates;
  if (!candidate) {
    return [];
  }

  const current = candidate.rollout_percentage > 0 ? [candidate] : [];
  return candidate.rollout_percentage === 100
    ? current
    : [...current, ...collectServableUpdates(rest)];
};

const isInRollout = (updateId: string, easClientId: string, rolloutPercentage: number) =>
  Effect.gen(function* () {
    const service = yield* CryptoService;
    const fraction = yield* service.sha256Fraction(updateId, easClientId);
    return fraction < rolloutPercentage / 100;
  });

const evaluateFallback = <T extends RolloutCandidate>(
  previous: T | undefined,
  easClientId: string | undefined,
): Effect.Effect<RolloutResolution<T>, CryptoError, CryptoService> =>
  Effect.gen(function* () {
    if (!previous) {
      return { resolved: false, needsFallbackQuery: false };
    }
    if (previous.rollout_percentage === 100) {
      return { resolved: true, update: previous };
    }
    if (previous.rollout_percentage === 0) {
      return { resolved: false, needsFallbackQuery: true };
    }
    if (!easClientId) {
      return { resolved: true, update: previous };
    }
    const inRollout = yield* isInRollout(previous.id, easClientId, previous.rollout_percentage);
    return inRollout
      ? { resolved: true, update: previous }
      : { resolved: false, needsFallbackQuery: true };
  });

export const resolveUpdateRollout = <T extends RolloutCandidate>(
  candidates: readonly T[],
  easClientId?: string,
): Effect.Effect<RolloutResolution<T> | null, CryptoError, CryptoService> =>
  Effect.gen(function* () {
    const [latest, previous] = candidates;
    if (!latest) {
      return null;
    }

    if (latest.rollout_percentage === 100) {
      return { resolved: true, update: latest };
    }

    if (latest.rollout_percentage === 0) {
      return yield* evaluateFallback(previous, easClientId);
    }

    if (!easClientId) {
      return yield* evaluateFallback(previous, easClientId);
    }

    const inRollout = yield* isInRollout(latest.id, easClientId, latest.rollout_percentage);
    if (inRollout) {
      return { resolved: true, update: latest };
    }

    return yield* evaluateFallback(previous, easClientId);
  });
